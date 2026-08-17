const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

async function uploadImage({ name, data, mime }) {
  const ext = path.extname(name || '') || '.img';
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (token) {
    const { put } = require('@vercel/blob');
    const key = `images/${crypto.randomBytes(8).toString('hex')}${ext}`;
    const blob = await put(key, Buffer.from(data, 'base64'), {
      access: 'public',
      contentType: mime,
      addRandomSuffix: false,
    });
    return { url: blob.url };
  }
  const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  const filename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
  fs.writeFileSync(path.join(uploadsDir, filename), Buffer.from(data, 'base64'));
  return { url: `/uploads/${filename}` };
}

module.exports = { uploadImage };