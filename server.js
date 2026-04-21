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
        button:disabled {
          background: #90a4ae;
          cursor: not-allowed;
        }
        .status {
          margin-top: 15px;
          padding: 12px;
          border-radius: 8px;
          background: #e3f2fd;
          color: #0d47a1;
          display: none;
        }
        .spinner {
          display: inline-block;
          width: 16px;
          height: 16px;
          border: 3px solid #bbdefb;
          border-top: 3px solid #1565C0;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          vertical-align: middle;
          margin-right: 8px;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .note {
          font-size: 14px;
          color: #666;
        }
      </style>
    </head>
    <body>
      <div class="box">
        <h1>Servidor FFmpeg activo</h1>
        <p>Sube un video para convertirlo a una versión comprimida.</p>
        <form id="uploadForm" action="/convert" method="post" enctype="multipart/form-data">
          <input type="file" id="video" name="video" accept="video/*" required>
          <button type="submit" id="submitBtn">Subir y convertir</button>
          <div class="status" id="statusBox">
            <span class="spinner"></span>
            Subiendo archivo y procesando video, espera por favor...
          </div>
          <p class="note">No cierres esta página hasta que aparezca el enlace de descarga.</p>
        </form>
      </div>

      <script>
        const form = document.getElementById('uploadForm');
        const submitBtn = document.getElementById('submitBtn');
        const statusBox = document.getElementById('statusBox');
        const videoInput = document.getElementById('video');

        form.addEventListener('submit', function (e) {
          if (!videoInput.files || !videoInput.files.length) {
            return;
          }

          submitBtn.disabled = true;
          submitBtn.textContent = 'Procesando...';
          statusBox.style.display = 'block';
        });
      </script>
    </body>
    </html>
  `);
});

app.post('/convert', upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).send('No se subió ningún archivo.');
  }

  const inputPath = req.file.path;

  const parsedName = path.parse(req.file.filename).name;
  const outputFileName = 'convertido-' + parsedName + '.mp4';
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
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Conversión completada</title>
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
          h2 {
            color: #1565C0;
            margin-top: 0;
          }
          a.button {
            display: inline-block;
            margin-top: 12px;
            padding: 12px 18px;
            background: #1565C0;
            color: white;
            text-decoration: none;
            border-radius: 8px;
          }
          a.link {
            display: inline-block;
            margin-top: 16px;
            color: #1565C0;
            text-decoration: none;
          }
        </style>
      </head>
      <body>
        <div class="box">
          <h2>Conversión completada</h2>
          <p>Tu archivo ya está listo para descargar.</p>
          <a class="button" href="/outputs/${outputFileName}" download>Descargar archivo convertido</a>
          <br>
          <a class="link" href="/">Volver</a>
        </div>
      </body>
      </html>
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
