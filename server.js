const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();

const uploadsDir = path.join(__dirname, 'uploads');
const outputsDir = path.join(__dirname, 'outputs');

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
if (!fs.existsSync(outputsDir)) fs.mkdirSync(outputsDir);

app.use('/outputs', express.static(outputsDir));

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + '-' + file.originalname.replace(/\s+/g, '_');
    cb(null, uniqueName);
  }
});

const upload = multer({ storage });

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>FFmpeg Service</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          background: #f4f6f8;
          padding: 40px;
        }
        .box {
          max-width: 600px;
          margin: auto;
          background: white;
          padding: 30px;
          border-radius: 12px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.08);
        }
        h1 {
          margin-top: 0;
        }
        input, button {
          width: 100%;
          padding: 12px;
          margin-top: 12px;
          font-size: 16px;
        }
        button {
          background: #1565C0;
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
        }
        button:hover {
          background: #0d47a1;
        }
      </style>
    </head>
    <body>
      <div class="box">
        <h1>Servidor FFmpeg activo</h1>
        <p>Sube un video MP4 para convertirlo a una versión comprimida.</p>
        <form action="/convert" method="post" enctype="multipart/form-data">
          <input type="file" name="video" accept="video/*" required />
          <button type="submit">Subir y convertir</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

app.post('/convert', upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).send('No se subió ningún archivo.');
  }

  const inputPath = req.file.path;
  const outputFileName = 'convertido-' + req.file.filename + '.mp4';
  const outputPath = path.join(outputsDir, outputFileName);

  const command = `ffmpeg -i "${inputPath}" -c:v libx265 -crf 35 -preset ultrafast -vf scale=1280:720 -c:a aac -b:a 48k "${outputPath}" -y`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(stderr);
      return res.status(500).send(`
        <h2>Error al convertir el video</h2>
        <pre>${stderr}</pre>
      `);
    }

    res.send(`
      <h2>Conversión completada</h2>
      <p><a href="/outputs/${outputFileName}" download>Descargar archivo convertido</a></p>
      <p><a href="/">Volver</a></p>
    `);
  });
});

const PORT = process.env.PORT || 80;
app.listen(PORT, () => {
  console.log(\`Servidor corriendo en puerto \${PORT}\`);
});
