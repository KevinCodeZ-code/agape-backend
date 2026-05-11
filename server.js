// ============================================
//  AGAPE FAMILY — Node.js Backend v2.0
//  Developer: Kevin
// ============================================

const express = require('express');
const mysql   = require('mysql2/promise');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');

// ── DATABASE ────────────────────────────────
const db = mysql.createPool({
  host:     process.env.MYSQLHOST     || 'localhost',
  user:     process.env.MYSQLUSER     || 'root',
  password: process.env.MYSQLPASSWORD || '',
  database: process.env.MYSQLDATABASE || 'agape_family',
  port:     process.env.MYSQLPORT     || 3306,
  waitForConnections: true,
  connectionLimit: 10
});

// ── INIT DATABASE ───────────────────────────
async function initDB() {
  try {
    const conn = await db.getConnection();
    console.log('Connected to MySQL');

    // Settings table
    await conn.query("CREATE TABLE IF NOT EXISTS settings (setting_key VARCHAR(50) PRIMARY KEY, setting_value TEXT NOT NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)");

    // Rotation table
    await conn.query("CREATE TABLE IF NOT EXISTS rotation (id INT AUTO_INCREMENT PRIMARY KEY, week VARCHAR(100) NOT NULL, worship_lead VARCHAR(100) NOT NULL, message VARCHAR(100))");

    // Photos table
    await conn.query("CREATE TABLE IF NOT EXISTS photos (person VARCHAR(20) PRIMARY KEY, file_path VARCHAR(255) NOT NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)");

    // Leaders table (self managed)
    await conn.query("CREATE TABLE IF NOT EXISTS leaders (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, title VARCHAR(100) NOT NULL, gender VARCHAR(10) NOT NULL, photo_path VARCHAR(255), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");

    // Prayers table with gender and delete token
    await conn.query("CREATE TABLE IF NOT EXISTS prayers (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, text TEXT NOT NULL, gender VARCHAR(10) NOT NULL DEFAULT 'other', delete_token VARCHAR(50) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");

    // Friday cancellations table
    await conn.query("CREATE TABLE IF NOT EXISTS cancellations (id INT AUTO_INCREMENT PRIMARY KEY, friday_date DATE NOT NULL, reason TEXT, cancelled_by VARCHAR(20), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");

    // Default settings
    await conn.query("INSERT IGNORE INTO settings (setting_key, setting_value) VALUES ('announcement', 'Welcome to Agape Family! Gather every Friday 5:30-6:00 PM.'), ('focus', 'This week: Growing in Love and Unity')");

    // Default rotation
    await conn.query("INSERT IGNORE INTO rotation (id, week, worship_lead, message) VALUES (1,'Week 1','TBA','TBA'),(2,'Week 2','TBA','TBA'),(3,'Week 3','TBA','TBA'),(4,'Week 4','TBA','TBA')");

    conn.release();
    console.log('All tables ready');
  } catch (err) {
    console.error('DB init failed:', err.message);
  }
}

// ── HELPERS ─────────────────────────────────
function ok(res, data)        { res.json({ success: true, ...data }); }
function fail(res, msg, code) { res.status(code || 500).json({ success: false, error: msg }); }

// Generate simple token
function makeToken() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// ── ADMIN AUTH ──────────────────────────────
const ADMINS = {
  maama: { password: 'maamaagape2026', gender: 'female', name: 'Maama Priscilla' },
  paapa: { password: 'papaagape2026',  gender: 'male',   name: 'Paapa Clinton'  }
};

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const admin = ADMINS[username];
  if (!admin || admin.password !== password) {
    return fail(res, 'Invalid credentials.', 401);
  }
  ok(res, {
    username,
    name:   admin.name,
    gender: admin.gender,
    token:  Buffer.from(username + ':' + password).toString('base64')
  });
});

// Middleware to verify admin
function verifyAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token) return fail(res, 'Unauthorized.', 401);
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const [username, password] = decoded.split(':');
    const admin = ADMINS[username];
    if (!admin || admin.password !== password) return fail(res, 'Unauthorized.', 401);
    req.admin = { username, ...admin };
    next();
  } catch (e) {
    fail(res, 'Unauthorized.', 401);
  }
}

// ── PRAYERS ─────────────────────────────────

// Submit prayer (public) — includes gender selection
app.post('/api/prayers', async (req, res) => {
  const { name, text, gender } = req.body;
  if (!name || !text) return fail(res, 'Name and text required.', 400);
  if (!['male', 'female'].includes(gender)) return fail(res, 'Please select your gender.', 400);
  try {
    const token = makeToken();
    await db.query(
      'INSERT INTO prayers (name, text, gender, delete_token) VALUES (?, ?, ?, ?)',
      [name, text, gender, token]
    );
    ok(res, { message: 'Prayer saved.', delete_token: token });
  } catch (e) { fail(res, e.message); }
});

// Delete own prayer using token (public)
app.delete('/api/prayers/:id', async (req, res) => {
  const { id } = req.params;
  const { delete_token } = req.body;
  if (!delete_token) return fail(res, 'Delete token required.', 400);
  try {
    const [rows] = await db.query('SELECT * FROM prayers WHERE id = ?', [id]);
    if (!rows.length) return fail(res, 'Prayer not found.', 404);
    if (rows[0].delete_token !== delete_token) return fail(res, 'Invalid token.', 403);
    await db.query('DELETE FROM prayers WHERE id = ?', [id]);
    ok(res, { message: 'Prayer deleted.' });
  } catch (e) { fail(res, e.message); }
});

// Admin delete any prayer
app.delete('/api/admin/prayers/:id', verifyAdmin, async (req, res) => {
  try {
    await db.query('DELETE FROM prayers WHERE id = ?', [req.params.id]);
    ok(res, { message: 'Prayer deleted.' });
  } catch (e) { fail(res, e.message); }
});

// Get prayers (admin only — filtered by gender)
app.get('/api/admin/prayers', verifyAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, name, text, gender, created_at FROM prayers WHERE gender = ? ORDER BY created_at DESC',
      [req.admin.gender]
    );
    ok(res, { prayers: rows });
  } catch (e) { fail(res, e.message); }
});

// ── ANNOUNCEMENT ────────────────────────────
app.get('/api/announcement', async (req, res) => {
  try {
    const [rows] = await db.query("SELECT setting_value FROM settings WHERE setting_key = 'announcement'");
    ok(res, { announcement: rows[0] ? rows[0].setting_value : '' });
  } catch (e) { fail(res, e.message); }
});

app.post('/api/announcement', verifyAdmin, async (req, res) => {
  const { announcement } = req.body;
  if (!announcement) return fail(res, 'Text required.', 400);
  try {
    await db.query("INSERT INTO settings (setting_key, setting_value) VALUES ('announcement', ?) ON DUPLICATE KEY UPDATE setting_value = ?", [announcement, announcement]);
    ok(res, { message: 'Announcement updated.' });
  } catch (e) { fail(res, e.message); }
});

// ── FOCUS ────────────────────────────────────
app.get('/api/focus', async (req, res) => {
  try {
    const [rows] = await db.query("SELECT setting_value FROM settings WHERE setting_key = 'focus'");
    ok(res, { focus: rows[0] ? rows[0].setting_value : '' });
  } catch (e) { fail(res, e.message); }
});

app.post('/api/focus', verifyAdmin, async (req, res) => {
  const { focus } = req.body;
  if (!focus) return fail(res, 'Text required.', 400);
  try {
    await db.query("INSERT INTO settings (setting_key, setting_value) VALUES ('focus', ?) ON DUPLICATE KEY UPDATE setting_value = ?", [focus, focus]);
    ok(res, { message: 'Focus updated.' });
  } catch (e) { fail(res, e.message); }
});

// ── ROTATION ─────────────────────────────────
app.get('/api/rotation', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT week, worship_lead, message FROM rotation ORDER BY id ASC');
    const rotation = rows.map(function(r) {
      return { week: r.week, lead: r.worship_lead, message: r.message };
    });
    ok(res, { rotation: rotation });
  } catch (e) { fail(res, e.message); }
});

app.post('/api/rotation', verifyAdmin, async (req, res) => {
  const { rotation } = req.body;
  if (!Array.isArray(rotation)) return fail(res, 'Array required.', 400);
  try {
    await db.query('DELETE FROM rotation');
    for (var i = 0; i < rotation.length; i++) {
      var r = rotation[i];
      await db.query('INSERT INTO rotation (week, worship_lead, message) VALUES (?, ?, ?)', [r.week || '', r.lead || '', r.message || '']);
    }
    ok(res, { message: 'Rotation updated.' });
  } catch (e) { fail(res, e.message); }
});

// ── FRIDAY CANCELLATION ──────────────────────
app.get('/api/cancellation', async (req, res) => {
  try {
    // Get next Friday's date
    const now = new Date();
    const day = now.getDay();
    const daysUntilFriday = (5 - day + 7) % 7 || 7;
    const nextFriday = new Date(now);
    nextFriday.setDate(now.getDate() + daysUntilFriday);
    const fridayStr = nextFriday.toISOString().split('T')[0];

    const [rows] = await db.query('SELECT * FROM cancellations WHERE friday_date = ?', [fridayStr]);
    ok(res, { cancelled: rows.length > 0, reason: rows[0] ? rows[0].reason : '', date: fridayStr });
  } catch (e) { fail(res, e.message); }
});

app.post('/api/cancellation', verifyAdmin, async (req, res) => {
  const { friday_date, reason } = req.body;
  if (!friday_date) return fail(res, 'Date required.', 400);
  try {
    await db.query(
      'INSERT INTO cancellations (friday_date, reason, cancelled_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE reason = ?',
      [friday_date, reason || '', req.admin.username, reason || '']
    );
    ok(res, { message: 'Friday cancelled.' });
  } catch (e) { fail(res, e.message); }
});

app.delete('/api/cancellation', verifyAdmin, async (req, res) => {
  const { friday_date } = req.body;
  try {
    await db.query('DELETE FROM cancellations WHERE friday_date = ?', [friday_date]);
    ok(res, { message: 'Cancellation removed. Friday is back on!' });
  } catch (e) { fail(res, e.message); }
});

// ── LEADERS (self managed) ───────────────────
app.get('/api/leaders', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT id, name, title, gender, photo_path FROM leaders ORDER BY id ASC');
    ok(res, { leaders: rows });
  } catch (e) { fail(res, e.message); }
});

app.post('/api/leaders', verifyAdmin, async (req, res) => {
  const { name, title, gender } = req.body;
  if (!name || !title || !gender) return fail(res, 'Name, title and gender required.', 400);
  try {
    await db.query('INSERT INTO leaders (name, title, gender) VALUES (?, ?, ?)', [name, title, gender]);
    ok(res, { message: 'Leader added.' });
  } catch (e) { fail(res, e.message); }
});

app.delete('/api/leaders/:id', verifyAdmin, async (req, res) => {
  try {
    await db.query('DELETE FROM leaders WHERE id = ?', [req.params.id]);
    ok(res, { message: 'Leader removed.' });
  } catch (e) { fail(res, e.message); }
});

// ── PHOTOS ───────────────────────────────────
app.get('/api/photos', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT person, file_path FROM photos');
    const photos = {};
    var base = process.env.RAILWAY_PUBLIC_DOMAIN ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN : 'http://localhost:' + PORT;
    rows.forEach(function(r) { photos[r.person] = base + '/uploads/' + r.file_path; });
    ok(res, { photos: photos });
  } catch (e) { fail(res, e.message); }
});

app.post('/api/photos', verifyAdmin, async (req, res) => {
  const { person, fileBase64, mimeType } = req.body;
  if (!person || !fileBase64 || !mimeType) return fail(res, 'Missing fields.', 400);
  try {
    var ext = mimeType.split('/')[1] || 'jpg';
    var filename = person + '_' + Date.now() + '.' + ext;
    var buffer = Buffer.from(fileBase64, 'base64');
    fs.writeFileSync(path.join(__dirname, 'uploads', filename), buffer);
    await db.query('INSERT INTO photos (person, file_path) VALUES (?, ?) ON DUPLICATE KEY UPDATE file_path = ?', [person, filename, filename]);
    ok(res, { message: 'Photo saved.' });
  } catch (e) { fail(res, e.message); }
});

// ── START ────────────────────────────────────
initDB().then(function() {
  app.listen(PORT, function() {
    console.log('AGAPE FAMILY v2.0 backend running on port ' + PORT);
  });
});
