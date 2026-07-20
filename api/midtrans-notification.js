// /api/midtrans-notification.js
// Ini adalah "Payment Notification URL" yang didaftarkan di dashboard Midtrans.
// Midtrans akan otomatis kirim POST ke sini setiap kali status pembayaran berubah
// (berhasil, gagal, kadaluarsa, dll) — bukan browser pengguna yang memanggil endpoint ini.
//
// Environment Variables yang wajib diset di Vercel:
//   MIDTRANS_SERVER_KEY
//   SUPABASE_SERVICE_ROLE_KEY

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const SUPABASE_URL = 'https://dkpztybbcvvzatgwhano.supabase.co';
const DURASI_PAKET_HARI = 30; // 1 bulan. Ubah di sini kalau nanti ada paket durasi lain.

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const notif = req.body || {};
    const { order_id, status_code, gross_amount, signature_key, transaction_status, fraud_status } = notif;

    if (!order_id || !status_code || !gross_amount || !signature_key) {
      return res.status(400).json({ error: 'Payload notifikasi tidak lengkap' });
    }

    const serverKey = process.env.MIDTRANS_SERVER_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serverKey || !serviceRoleKey) {
      console.error('Env var MIDTRANS_SERVER_KEY / SUPABASE_SERVICE_ROLE_KEY belum diset');
      return res.status(500).json({ error: 'Server belum dikonfigurasi' });
    }

    // 1) WAJIB verifikasi signature, supaya orang lain tidak bisa memalsukan
    //    notifikasi "pembayaran berhasil" langsung ke endpoint ini.
    const expectedSignature = crypto
      .createHash('sha512')
      .update(order_id + status_code + gross_amount + serverKey)
      .digest('hex');

    if (expectedSignature !== signature_key) {
      console.warn('Signature tidak cocok untuk order_id:', order_id);
      // PENTING: tetap balas 200 (bukan 403/401), supaya Midtrans tidak menganggap
      // endpoint ini error dan mengirim ulang notifikasi berkali-kali. Kita cukup
      // tidak memproses datanya kalau signature tidak valid — ini praktik yang
      // direkomendasikan Midtrans, termasuk untuk tombol "Test notification URL".
      return res.status(200).json({ message: 'Signature tidak valid, diabaikan' });
    }

    // 2) Tentukan status akhir transaksi
    let finalStatus = 'pending';
    if (transaction_status === 'capture') {
      finalStatus = fraud_status === 'accept' ? 'success' : 'pending';
    } else if (transaction_status === 'settlement') {
      finalStatus = 'success';
    } else if (['cancel', 'deny', 'expire'].includes(transaction_status)) {
      finalStatus = 'failed';
    } else if (transaction_status === 'pending') {
      finalStatus = 'pending';
    }

    const sbAdmin = createClient(SUPABASE_URL, serviceRoleKey);

    // 3) Ambil data transaksi yang sudah dicatat waktu create-transaction
    const { data: trx, error: trxError } = await sbAdmin
      .from('transactions')
      .select('*')
      .eq('order_id', order_id)
      .maybeSingle();

    if (trxError || !trx) {
      console.error('Transaksi tidak ditemukan untuk order_id:', order_id);
      // Tetap balas 200 supaya Midtrans tidak retry terus untuk order_id yang memang tidak ada
      return res.status(200).json({ message: 'Transaksi tidak ditemukan, diabaikan' });
    }

    // 4) Update status transaksi
    await sbAdmin.from('transactions').update({ status: finalStatus }).eq('order_id', order_id);

    // 5) Kalau sukses, aktifkan paket user di tabel profiles
    if (finalStatus === 'success') {
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + DURASI_PAKET_HARI);

      const { error: profileError } = await sbAdmin
        .from('profiles')
        .update({
          plan: trx.package_key,
          plan_expiry: expiry.toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', trx.user_id);

      if (profileError) {
        console.error('Gagal update plan user:', profileError.message);
      }
    }

    return res.status(200).json({ message: 'OK' });

  } catch (err) {
    console.error('midtrans-notification error:', err);
    return res.status(500).json({ error: 'Terjadi kesalahan server: ' + err.message });
  }
};
