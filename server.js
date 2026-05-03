// ============================================
//  AGAPE FAMILY — Node.js Backend
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

const db = mysql.createPool({
  host:     process.env.MYSQLHOST     || 'localhost',
  user:     process.env.MYSQLUSER     || 'root',
  password: process.env.MYSQLPASSWORD || '',
  database: process.env.MYSQLDATABASE || 'agape_family',
  port:     process.env.MYSQLPORT     || 3306,
  waitForConnections: true,
  connectionLimit: 10
});

async function initDB() {
  try {
    const conn = await db.getConnection();
    console.log('Connected to Railway MySQL');

    await conn.query("CREATE TABLE IF NOT EXISTS prayers (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, text TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
    await conn.query("CREATE TABLE IF NOT EXISTS settings (setting_key VARCHAR(50) PRIMARY KEY, setting_value TEXT NOT NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)");
    await conn.query("CREATE TABLE IF NOT EXISTS rotation (id INT AUTO_INCREMENT PRIMARY KEY, week VARCHAR(100) NOT NULL, worship_lead VARCHAR(100) NOT NULL, message VARCHAR(100))");
    await conn.query("CREATE TABLE IF NOT EXISTS photos (person VARCHAR(20) PRIMARY KEY, file_path VARCHAR(255) NOT NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)");

    await conn.query("INSERT IGNORE INTO settings (setting_key, setting_value) VALUES ('announcement', 'Welcome to Agape Family! Gather every Friday 5:30-6:00 PM.'), ('focus', 'This week: Growing in Love and Unity')");
    await conn.query("INSERT IGNORE INTO rotation (id, week, worship_lead, message) VALUES (1,'Week 1','TBA','TBA'),(2,'Week 2','TBA','TBA'),(3,'Week 3','TBA','TBA'),(4,'Week 4','TBA','TBA')");

    conn.release();
    console.log('Tables ready');
  } catch (err) {
    console.error('DB init failed:', err.message);
  }
}

function ok(res, data)         { res.json({ success: true, ...data }); }
function fail(res, msg, code)  { res.status(code || 500).json({ success: false, error: msg }); }

// PRAYERS
app.get('/api/prayers', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT id, name, text, created_at FROM prayers ORDER BY created_at DESC');
    ok(res, { prayers: rows });
  } catch (e) { fail(res, e.message); }
});

app.post('/api/prayers', async (req, res) => {
  const { name, text } = req.body;
  if (!name || !text) return fail(res, 'Name and text required.', 400);
  try {
    await db.query('INSERT INTO prayers (name, text) VALUES (?, ?)', [name, text]);
    ok(res, { message: 'Prayer saved.' });
  } catch (e) { fail(res, e.message); }
});

// ANNOUNCEMENT
app.get('/api/announcement', async (req, res) => {
  try {
    const [rows] = await db.query("SELECT setting_value FROM settings WHERE setting_key = 'announcement'");
    ok(res, { announcement: rows[0] ? rows[0].setting_value : '' });
  } catch (e) { fail(res, e.message); }
});

app.post('/api/announcement', async (req, res) => {
  const { announcement } = req.body;
  if (!announcement) return fail(res, 'Text required.', 400);
  try {
    await db.query("INSERT INTO settings (setting_key, setting_value) VALUES ('announcement', ?) ON DUPLICATE KEY UPDATE setting_value = ?", [announcement, announcement]);
    ok(res, { message: 'Announcement updated.' });
  } catch (e) { fail(res, e.message); }
});

// FOCUS
app.get('/api/focus', async (req, res) => {
  try {
    const [rows] = await db.query("SELECT setting_value FROM settings WHERE setting_key = 'focus'");
    ok(res, { focus: rows[0] ? rows[0].setting_value : '' });
  } catch (e) { fail(res, e.message); }
});

app.post('/api/focus', async (req, res) => {
  const { focus } = req.body;
  if (!focus) return fail(res, 'Text required.', 400);
  try {
    await db.query("INSERT INTO settings (setting_key, setting_value) VALUES ('focus', ?) ON DUPLICATE KEY UPDATE setting_value = ?", [focus, focus]);
    ok(res, { message: 'Focus updated.' });
  } catch (e) { fail(res, e.message); }
});

// ROTATION
app.get('/api/rotation', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT week, worship_lead, message FROM rotation ORDER BY id ASC');
    const rotation = rows.map(function(r) {
      return { week: r.week, lead: r.worship_lead, message: r.message };
    });
    ok(res, { rotation: rotation });
  } catch (e) { fail(res, e.message); }
});

app.post('/api/rotation', async (req, res) => {
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

// PHOTOS
app.get('/api/photos', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT person, file_path FROM photos');
    const photos = {};
    var base = process.env.RAILWAY_PUBLIC_DOMAIN ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN : 'http://localhost:' + PORT;
    rows.forEach(function(r) { photos[r.person] = base + '/uploads/' + r.file_path; });
    ok(res, { photos: photos });
  } catch (e) { fail(res, e.message); }
});

app.post('/api/photos', async (req, res) => {
  const { person, fileBase64, mimeType } = req.body;
  if (!person || !fileBase64 || !mimeType) return fail(res, 'Missing fields.', 400);
  if (person !== 'maama' && person !== 'paapa') return fail(res, 'Invalid person.', 400);
  try {
    var ext = mimeType.split('/')[1] || 'jpg';
    var filename = person + '_' + Date.now() + '.' + ext;
    var buffer = Buffer.from(fileBase64, 'base64');
    fs.writeFileSync(path.join(__dirname, 'uploads', filename), buffer);
    await db.query('INSERT INTO photos (person, file_path) VALUES (?, ?) ON DUPLICATE KEY UPDATE file_path = ?', [person, filename, filename]);
    ok(res, { message: 'Photo saved.', filename: filename });
  } catch (e) { fail(res, e.message); }
});

initDB().then(function() {
  app.listen(PORT, function() {
    console.log('AGAPE FAMILY backend running on port ' + PORT);
  });
});
