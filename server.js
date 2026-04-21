const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();

const uploadsDir = path.join(__dirname, 'uploads');
const outputsDir = path.join(__dirname, 'outputs');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

if (!fs.existsSync(outputsDir)) {
  fs.mkdirSync(outputsDir, { recursive: true });
}

app.use('/outputs', express.static(outputsDir));

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const safeName = file.originalname.replace(/\s+/g, '_');
    cb(null, Date.now() + '-' + safeName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 200 * 1024 * 1024
  }
});

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
          margin: 0;
        }
        .box {
          max-width: 600px;
          margin: 40px auto;
          background: white;
          padding: 30px;
          border-radius: 12px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.08);
        }
        h1 {
          margin-top: 0;
          color: #1565C0;
        }
        p {
          color: #444;
        }
        input, button {
          width: 100%;
          padding: 12px;
          margin-top: 12px;
          font-size: 16px;
          box-sizing: border-box;
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
        <p>Sube un video para convertirlo a una versión comprimida.</p>
        <form action="/convert" method="post" enctype="multipart/form-data">
          <input type="file" name="video" accept="video/*" required>
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

  const args = [
    '-i', inputPath,
    '-c:v', 'libx265',
    '-crf', '35',
    '-preset', 'ultrafast',
    '-vf', 'scale=1280:720',
    '-c:a', 'aac',
    '-b:a', '48k',
    '-y',
    outputPath
  ];

  const ffmpeg = spawn('ffmpeg', args);

  let errorOutput = '';

  ffmpeg.stderr.on('data', (data) => {
    errorOutput += data.toString();
    console.log(data.toString());
  });

  ffmpeg.on('close', (code) => {
    if (code !== 0) {
      return res.status(500).send(`
        <h2>Error al convertir el video</h2>
        <pre>${errorOutput}</pre>
        <p><a href="/">Volver</a></p>
      `);
    }

    res.send(`
      <h2>Conversión completada</h2>
      <p><a href="/outputs/${outputFileName}" download>Descargar archivo convertido</a></p>
      <p><a href="/">Volver</a></p>
    `);
  });

  ffmpeg.on('error', (err) => {
    return res.status(500).send(`
      <h2>Error al ejecutar FFmpeg</h2>
      <pre>${err.message}</pre>
      <p><a href="/">Volver</a></p>
    `);
  });
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).send('Error de subida: ' + err.message);
  }

  if (err) {
    return res.status(500).send('Error del servidor: ' + err.message);
  }

  next();
});

const PORT = process.env.PORT || 80;
app.listen(PORT, function () {
  console.log('Servidor corriendo en puerto ' + PORT);
});
