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
    fileSize: 300 * 1024 * 1024
  }
});

function cleanOldFiles(folderPath, maxAgeMs) {
  fs.readdir(folderPath, (err, files) => {
    if (err) {
      console.error('Error leyendo carpeta:', folderPath, err.message);
      return;
    }

    files.forEach((file) => {
      const filePath = path.join(folderPath, file);

      fs.stat(filePath, (statErr, stats) => {
        if (statErr) {
          console.error('Error leyendo archivo:', filePath, statErr.message);
          return;
        }

        const now = Date.now();
        const fileAge = now - stats.mtimeMs;

        if (fileAge > maxAgeMs) {
          fs.unlink(filePath, (unlinkErr) => {
            if (unlinkErr) {
              console.error('Error eliminando archivo:', filePath, unlinkErr.message);
            } else {
              console.log('Archivo eliminado por antigüedad:', filePath);
            }
          });
        }
      });
    });
  });
}

function runCleanup() {
  const twoHours = 2 * 60 * 60 * 1000;
  cleanOldFiles(uploadsDir, twoHours);
  cleanOldFiles(outputsDir, twoHours);
}

runCleanup();
setInterval(runCleanup, 30 * 60 * 1000);

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
          max-width: 700px;
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
        input, select, button {
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
        .progress-wrap {
          margin-top: 16px;
          display: none;
        }
        .progress-bar-bg {
          width: 100%;
          height: 20px;
          background: #dfe6eb;
          border-radius: 999px;
          overflow: hidden;
        }
        .progress-bar-fill {
          width: 0%;
          height: 100%;
          background: #1565C0;
          transition: width 0.2s ease;
        }
        .progress-text {
          margin-top: 8px;
          font-size: 14px;
          color: #444;
        }
        .result {
          margin-top: 20px;
          display: none;
          padding: 16px;
          background: #f1f8e9;
          border-radius: 8px;
        }
        .error {
          margin-top: 20px;
          display: none;
          padding: 16px;
          background: #ffebee;
          border-radius: 8px;
          color: #b71c1c;
          white-space: pre-wrap;
        }
        a.button-link {
          display: inline-block;
          margin-top: 12px;
          padding: 12px 18px;
          background: #1565C0;
          color: white;
          text-decoration: none;
          border-radius: 8px;
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
        <p>Sube un archivo y elige qué quieres hacer.</p>

        <form id="uploadForm">
          <input type="file" id="video" name="video" accept="video/*,audio/*" required>

          <select name="preset" id="preset" required>
            <option value="compress">Comprimir video</option>
            <option value="mp3">Extraer MP3</option>
            <option value="whatsapp">Convertir para WhatsApp</option>
          </select>

          <button type="submit" id="submitBtn">Procesar archivo</button>

          <div class="status" id="statusBox"></div>

          <div class="progress-wrap" id="progressWrap">
            <div class="progress-bar-bg">
              <div class="progress-bar-fill" id="progressBar"></div>
            </div>
            <div class="progress-text" id="progressText">0%</div>
          </div>

          <div class="result" id="resultBox"></div>
          <div class="error" id="errorBox"></div>

          <p class="note">La barra muestra la subida del archivo. Después verás el estado de procesamiento.</p>
        </form>
      </div>

      <script>
        const form = document.getElementById('uploadForm');
        const submitBtn = document.getElementById('submitBtn');
        const statusBox = document.getElementById('statusBox');
        const progressWrap = document.getElementById('progressWrap');
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        const resultBox = document.getElementById('resultBox');
        const errorBox = document.getElementById('errorBox');
        const videoInput = document.getElementById('video');
        const presetInput = document.getElementById('preset');

        form.addEventListener('submit', function (e) {
          e.preventDefault();

          if (!videoInput.files || !videoInput.files.length) {
            return;
          }

          submitBtn.disabled = true;
          submitBtn.textContent = 'Enviando...';
          resultBox.style.display = 'none';
          errorBox.style.display = 'none';
          resultBox.innerHTML = '';
          errorBox.textContent = '';
          statusBox.style.display = 'block';
          statusBox.textContent = 'Preparando subida...';
          progressWrap.style.display = 'block';
          progressBar.style.width = '0%';
          progressText.textContent = '0%';

          const formData = new FormData();
          formData.append('video', videoInput.files[0]);
          formData.append('preset', presetInput.value);

          const xhr = new XMLHttpRequest();
          xhr.open('POST', '/convert', true);

          xhr.upload.onprogress = function (event) {
            if (event.lengthComputable) {
              const percent = Math.round((event.loaded / event.total) * 100);
              progressBar.style.width = percent + '%';
              progressText.textContent = percent + '%';
              statusBox.textContent = 'Subiendo archivo...';
              submitBtn.textContent = 'Subiendo...';
            }
          };

          xhr.onload = function () {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Procesar archivo';

            if (xhr.status >= 200 && xhr.status < 300) {
              let response;
              try {
                response = JSON.parse(xhr.responseText);
              } catch (err) {
                errorBox.style.display = 'block';
                errorBox.textContent = 'Respuesta inválida del servidor.';
                return;
              }

              if (response.ok) {
                progressBar.style.width = '100%';
                progressText.textContent = '100%';
                statusBox.textContent = 'Procesamiento completado.';
                resultBox.style.display = 'block';
                resultBox.innerHTML = '<strong>Archivo listo.</strong><br><a class="button-link" href="' + response.downloadUrl + '" download>Descargar resultado</a>';
              } else {
                errorBox.style.display = 'block';
                errorBox.textContent = response.error || 'Ocurrió un error.';
              }
            } else {
              errorBox.style.display = 'block';
              errorBox.textContent = 'Error HTTP ' + xhr.status + ': ' + xhr.responseText;
            }
          };

          xhr.onerror = function () {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Procesar archivo';
            errorBox.style.display = 'block';
            errorBox.textContent = 'Error de red o conexión.';
          };

          xhr.onloadstart = function () {
            statusBox.textContent = 'Iniciando subida...';
          };

          xhr.onreadystatechange = function () {
            if (xhr.readyState === 2) {
              statusBox.textContent = 'Archivo subido. Procesando en servidor...';
              submitBtn.textContent = 'Procesando...';
            }
          };

          xhr.send(formData);
        });
      </script>
    </body>
    </html>
  `);
});

app.post('/convert', upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'No se subió ningún archivo.' });
  }

  const preset = req.body.preset || 'compress';
  const inputPath = req.file.path;
  const parsedName = path.parse(req.file.filename).name;

  let outputFileName = '';
  let args = [];

  if (preset === 'compress') {
    outputFileName = 'comprimido-' + parsedName + '.mp4';
    const outputPath = path.join(outputsDir, outputFileName);

    args = [
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
  } else if (preset === 'mp3') {
    outputFileName = 'audio-' + parsedName + '.mp3';
    const outputPath = path.join(outputsDir, outputFileName);

    args = [
      '-i', inputPath,
      '-vn',
      '-c:a', 'libmp3lame',
      '-b:a', '128k',
      '-y',
      outputPath
    ];
  } else if (preset === 'whatsapp') {
    outputFileName = 'whatsapp-' + parsedName + '.mp4';
    const outputPath = path.join(outputsDir, outputFileName);

    args = [
      '-i', inputPath,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '30',
      '-vf', 'scale=854:480',
      '-c:a', 'aac',
      '-b:a', '64k',
      '-movflags', '+faststart',
      '-y',
      outputPath
    ];
  } else {
    return res.status(400).json({ ok: false, error: 'Preset no válido.' });
  }

  const ffmpeg = spawn('ffmpeg', args);
  let errorOutput = '';

  ffmpeg.stderr.on('data', (data) => {
    errorOutput += data.toString();
    console.log(data.toString());
  });

  ffmpeg.on('close', (code) => {
    if (code !== 0) {
      return res.status(500).json({
        ok: false,
        error: errorOutput || 'Error al procesar el archivo.'
      });
    }

    return res.json({
      ok: true,
      downloadUrl: '/outputs/' + outputFileName,
      fileName: outputFileName
    });
  });

  ffmpeg.on('error', (err) => {
    return res.status(500).json({
      ok: false,
      error: err.message
    });
  });
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      ok: false,
      error: 'Error de subida: ' + err.message
    });
  }

  if (err) {
    return res.status(500).json({
      ok: false,
      error: 'Error del servidor: ' + err.message
    });
  }

  next();
});

const PORT = process.env.PORT || 80;
app.listen(PORT, function () {
  console.log('Servidor corriendo en puerto ' + PORT);
});
