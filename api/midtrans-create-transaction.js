// /api/midtrans-create-transaction.js
// Endpoint backend yang dipanggil upgrade.html untuk membuat transaksi Midtrans.
// Server Key diambil dari Environment Variables Vercel — TIDAK PERNAH terlihat di browser.
//
// Environment Variables yang wajib diset di Vercel Project Settings:
// MIDTRANS_SERVER_KEY -> Server Key dari dashboard Midtrans (Sandbox atau Production)
// MIDTRANS_ENV -> 'sandbox' atau 'production'
// SUPABASE_SERVICE_ROLE_KEY -> dari Supabase Settings > API (service_role, RAHASIA)

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://dkpztybbcvvzatgwhano.supabase.co";

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { package_key, user_id, user_email, user_name, flash_durasi } =
      req.body || {};

    if (!package_key || !user_id || !user_email) {
      return res
        .status(400)
        .json({ error: "package_key, user_id, dan user_email wajib diisi" });
    }

    const serverKey = process.env.MIDTRANS_SERVER_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const isProduction = process.env.MIDTRANS_ENV === "production";

    if (!serverKey) {
      return res
        .status(500)
        .json({
          error:
            "MIDTRANS_SERVER_KEY belum diset di Environment Variables Vercel",
        });
    }
    if (!serviceRoleKey) {
      return res
        .status(500)
        .json({
          error:
            "SUPABASE_SERVICE_ROLE_KEY belum diset di Environment Variables Vercel",
        });
    }

    const sbAdmin = createClient(SUPABASE_URL, serviceRoleKey);

    // 1) Ambil harga ASLI paket dari database (JANGAN PERNAH percaya harga dari browser,
    // supaya orang tidak bisa mengubah harga lewat DevTools/console).
    // Handle Promo Kilat (package_key === 'flash') — ambil harga dari flash_promo_settings
    let amount, pkgLabel;
    if (package_key === "flash") {
      const { data: fp, error: fpError } = await sbAdmin
        .from("flash_promo_settings")
        .select("*")
        .eq("id", 1)
        .maybeSingle();
      if (fpError || !fp || !fp.active) {
        return res
          .status(400)
          .json({ error: "Promo Kilat tidak aktif atau tidak ditemukan" });
      }
      amount = Math.round(Number(fp.harga));
      pkgLabel = fp.label || "Promo Kilat";
    } else {
      const { data: pkg, error: pkgError } = await sbAdmin
        .from("packages")
        .select("*")
        .eq("key", package_key)
        .eq("active", true)
        .maybeSingle();
      if (pkgError || !pkg) {
        return res
          .status(400)
          .json({ error: "Paket tidak ditemukan atau tidak aktif" });
      }
      amount = Math.round(Number(pkg.real_price));
      pkgLabel = pkg.label || package_key;
    }
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Harga paket tidak valid" });
    }

    // 2) Buat order_id unik & pendek (Midtrans maksimal 50 karakter)
    const orderId =
      "AK" + Date.now() + Math.random().toString(36).slice(2, 8).toUpperCase();

    // 3) Catat transaksi berstatus 'pending' dulu, supaya webhook nanti tahu
    // transaksi ini milik user & paket yang mana.
    const { error: insertError } = await sbAdmin.from("transactions").insert({
      order_id: orderId,
      user_id,
      user_email,
      package_key,
      amount,
      status: "pending",
      ...(package_key === "flash" && flash_durasi
        ? { flash_durasi_hari: Number(flash_durasi) }
        : {}),
    });

    if (insertError) {
      console.error("Gagal insert transaksi:", insertError.message);
      return res
        .status(500)
        .json({
          error: "Gagal menyimpan data transaksi: " + insertError.message,
        });
    }

    // 4) Minta Snap Token ke Midtrans
    const baseUrl = isProduction
      ? "https://app.midtrans.com"
      : "https://app.sandbox.midtrans.com";

    const authHeader =
      "Basic " + Buffer.from(serverKey + ":").toString("base64");

    const nameParts = (user_name || "Pengguna AsistenKu").trim().split(" ");
    const firstName = nameParts[0] || "Pengguna";
    const lastName = nameParts.slice(1).join(" ") || "-";

    const midtransRes = await fetch(baseUrl + "/snap/v1/transactions", {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        transaction_details: {
          order_id: orderId,
          gross_amount: amount,
        },
        customer_details: {
          first_name: firstName,
          last_name: lastName,
          email: user_email,
        },
        item_details: [
          {
            id: package_key,
            price: amount,
            quantity: 1,
            name: "Paket " + pkgLabel + " - AsistenKu.pro",
          },
        ],
      }),
    });

    const midtransData = await midtransRes.json();

    if (!midtransRes.ok) {
      console.error("Midtrans error:", midtransData);
      return res
        .status(midtransRes.status)
        .json({
          error:
            midtransData.error_messages?.join(", ") ||
            "Gagal membuat transaksi Midtrans",
        });
    }

    return res.status(200).json({
      token: midtransData.token,
      redirect_url: midtransData.redirect_url,
      order_id: orderId,
    });
  } catch (err) {
    console.error("midtrans-create-transaction error:", err);
    return res
      .status(500)
      .json({ error: "Terjadi kesalahan server: " + err.message });
  }
};
