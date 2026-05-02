// ============================================
//  AGAPE FAMILY — Node.js Backend
//  Developer: Kevin
//  Run with: node server.js
// ============================================

const express = require('express');
const mysql   = require('mysql2/promise');
const cors    = require('cors');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = 3000;

// ── MIDDLEWARE ──────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));   // allow large base64 images
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Ensure uploads folder exists
if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');

// ── DATABASE CONNECTION ─────────────────────
const db = mysql.createPool({
  host:     'localhost',
  user:     'root',       // default XAMPP user
  password: '',           // default XAMPP password (empty)
  database: 'agape_family2',
  waitForConnections: true,
  connectionLimit: 10
});

// Test DB connection on startup
db.getConnection()
  .then(conn => {
    console.log('✅ Connected to MySQL (XAMPP)');
    conn.release();
  })
  .catch(err => {
    console.error('❌ MySQL connection failed:', err.message);
    console.error('   Make sure XAMPP MySQL is running and the database exists.');
  });

// ── HELPER ─────────────────────────────────
function ok(res, data = {})  { res.json({ success: true,  ...data }); }
function err(res, msg, code = 500) { res.status(code).json({ success: false, error: msg }); }

// ═══════════════════════════════════════════
//  ROUTES
// ═══════════════════════════════════════════

// ── PRAYERS ────────────────────────────────

// GET /api/prayers — fetch all prayer requests
app.get('/api/prayers', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, name, text, created_at FROM prayers ORDER BY created_at DESC'
    );
    ok(res, { prayers: rows });
  } catch (e) {
    err(res, e.message);
  }
});

// POST /api/prayers — submit a new prayer request
app.post('/api/prayers', async (req, res) => {
  const { name, text } = req.body;
  if (!name || !text) return err(res, 'Name and text are required.', 400);
  try {
    await db.query('INSERT INTO prayers (name, text) VALUES (?, ?)', [name, text]);
    ok(res, { message: 'Prayer request saved.' });
  } catch (e) {
    err(res, e.message);
  }
});

// ── ANNOUNCEMENT ───────────────────────────

// GET /api/announcement
app.get('/api/announcement', async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT setting_value FROM settings WHERE setting_key = 'announcement'"
    );
    ok(res, { announcement: rows[0]?.setting_value || '' });
  } catch (e) {
    err(res, e.message);
  }
});

// POST /api/announcement (admin only — protected by frontend code)
app.post('/api/announcement', async (req, res) => {
  const { announcement } = req.body;
  if (!announcement) return err(res, 'Announcement text required.', 400);
  try {
    await db.query(
      "INSERT INTO settings (setting_key, setting_value) VALUES ('announcement', ?) ON DUPLICATE KEY UPDATE setting_value = ?",
      [announcement, announcement]
    );
    ok(res, { message: 'Announcement updated.' });
  } catch (e) {
    err(res, e.message);
  }
});

// ── WEEKLY FOCUS ────────────────────────────

// GET /api/focus
app.get('/api/focus', async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT setting_value FROM settings WHERE setting_key = 'focus'"
    );
    ok(res, { focus: rows[0]?.setting_value || '' });
  } catch (e) {
    err(res, e.message);
  }
});

// POST /api/focus
app.post('/api/focus', async (req, res) => {
  const { focus } = req.body;
  if (!focus) return err(res, 'Focus text required.', 400);
  try {
    await db.query(
      "INSERT INTO settings (setting_key, setting_value) VALUES ('focus', ?) ON DUPLICATE KEY UPDATE setting_value = ?",
      [focus, focus]
    );
    ok(res, { message: 'Focus updated.' });
  } catch (e) {
    err(res, e.message);
  }
});

// ── ROTATION ────────────────────────────────

// GET /api/rotation
app.get('/api/rotation', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT week, lead, message FROM rotation ORDER BY id ASC');
    ok(res, { rotation: rows });
  } catch (e) {
    err(res, e.message);
  }
});

// POST /api/rotation — replace entire rotation table
app.post('/api/rotation', async (req, res) => {
  const { rotation } = req.body;
  if (!Array.isArray(rotation)) return err(res, 'Rotation must be an array.', 400);
  try {
    await db.query('DELETE FROM rotation');
    for (const row of rotation) {
      await db.query(
        'INSERT INTO rotation (week, lead, message) VALUES (?, ?, ?)',
        [row.week || '', row.lead || '', row.message || '']
      );
    }
    ok(res, { message: 'Rotation updated.' });
  } catch (e) {
    err(res, e.message);
  }
});

// ── PHOTOS ──────────────────────────────────

// GET /api/photos — returns photo URLs
app.get('/api/photos', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT person, file_path FROM photos');
    const photos = {};
    rows.forEach(r => { photos[r.person] = `http://localhost:${PORT}/uploads/${r.file_path}`; });
    ok(res, { photos });
  } catch (e) {
    err(res, e.message);
  }
});

// POST /api/photos — upload base64 image for maama or paapa
app.post('/api/photos', async (req, res) => {
  const { person, fileBase64, mimeType } = req.body;
  if (!person || !fileBase64 || !mimeType) return err(res, 'Missing fields.', 400);
  if (!['maama', 'paapa'].includes(person))  return err(res, 'Invalid person.', 400);

  try {
    const ext      = mimeType.split('/')[1] || 'jpg';
    const filename = `${person}_${Date.now()}.${ext}`;
    const buffer   = Buffer.from(fileBase64, 'base64');
    fs.writeFileSync(path.join(__dirname, 'uploads', filename), buffer);

    await db.query(
      'INSERT INTO photos (person, file_path) VALUES (?, ?) ON DUPLICATE KEY UPDATE file_path = ?',
      [person, filename, filename]
    );
    ok(res, { message: 'Photo saved.', filename });
  } catch (e) {
    err(res, e.message);
  }
});

// ── START SERVER ────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🙏 AGAPE FAMILY backend running`);
  console.log(`   → http://localhost:${PORT}`);
  console.log(`   → API: http://localhost:${PORT}/api/prayers\n`);
});