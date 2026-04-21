const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();

const uploadsDir = path.join(__dirname, 'uploads');
const outputsDir = path.join(__dirname, 'outputs');

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(outputsDir)) fs.mkdirSync(outputsDir, { recursive: true });

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
  storage,
  limits: {
    fileSize: 300 * 1024 * 1024
  }
});

function cleanOldFiles(folderPath, maxAgeMs) {
  fs.readdir(folderPath, (err, files) => {
    if (err) return console.error('Error leyendo carpeta:', folderPath, err.message);

    files.forEach((file) => {
      const filePath = path.join(folderPath, file);
      fs.stat(filePath, (statErr, stats) => {
        if (statErr) return console.error('Error leyendo archivo:', filePath, statErr.message);

        const fileAge = Date.now() - stats.mtimeMs;
        if (fileAge > maxAgeMs) {
          fs.unlink(filePath, (unlinkErr) => {
            if (unlinkErr) {
              console.error('Error eliminando archivo:', filePath, unlinkErr.message);
            } else {
              console.log('Archivo eliminado:', filePath);
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

function safeValue(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function buildVideoArgs(req, inputPath, outputPath, outputFormat) {
  const videoCodec = safeValue(req.body.videoCodec, ['libx264', 'libx265', 'none'], 'libx264');
  const qualityMode = safeValue(req.body.qualityMode, ['crf', 'bitrate'], 'crf');
  const crf = safeValue(req.body.crf, ['18', '20', '23', '28', '30', '35', '40', '45'], '28');
  const encodePreset = safeValue(req.body.encodePreset, ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow'], 'medium');
  const resolution = safeValue(req.body.resolution, ['source', '1920:1080', '1280:720', '854:480', '640:360'], 'source');
  const fps = safeValue(req.body.fps, ['source', '60', '30', '24', '15'], 'source');

  const videoBitrate = safeValue(req.body.videoBitrate, ['300k', '500k', '800k', '1000k', '1500k', '2000k', '3000k', '5000k'], '1000k');
  const maxrate = safeValue(req.body.maxrate, ['none', '500k', '800k', '1200k', '1500k', '2500k', '4000k', '6000k'], 'none');
  const minrate = safeValue(req.body.minrate, ['none', '300k', '500k', '800k', '1000k', '1500k', '2500k'], 'none');
  const bufsize = safeValue(req.body.bufsize, ['none', '500k', '1000k', '2000k', '4000k', '8000k'], 'none');

  const audioCodec = safeValue(req.body.audioCodec, ['aac', 'libmp3lame', 'pcm_s16le', 'copy', 'none'], 'aac');
  const audioBitrate = safeValue(req.body.audioBitrate, ['32k', '48k', '64k', '96k', '128k', '192k', '320k'], '128k');
  const audioChannels = safeValue(req.body.audioChannels, ['1', '2'], '2');
  const audioRate = safeValue(req.body.audioRate, ['22050', '32000', '44100', '48000'], '44100');

  const args = ['-i', inputPath];

  if (videoCodec === 'none') {
    args.push('-vn');
  } else {
    args.push('-c:v', videoCodec);

    if (videoCodec === 'libx264' || videoCodec === 'libx265') {
      args.push('-preset', encodePreset);

      if (qualityMode === 'crf') {
        args.push('-crf', crf);
      } else {
        args.push('-b:v', videoBitrate);
        if (maxrate !== 'none') args.push('-maxrate', maxrate);
        if (minrate !== 'none') args.push('-minrate', minrate);
        if (bufsize !== 'none') args.push('-bufsize', bufsize);
      }
    }

    if (resolution !== 'source') {
      args.push('-vf', 'scale=' + resolution);
    }

    if (fps !== 'source') {
      args.push('-r', fps);
    }
  }

  if (audioCodec === 'none') {
    args.push('-an');
  } else if (audioCodec === 'copy') {
    args.push('-c:a', 'copy');
  } else if (audioCodec === 'pcm_s16le') {
    args.push('-c:a', 'pcm_s16le', '-ar', audioRate, '-ac', audioChannels);
  } else {
    args.push('-c:a', audioCodec, '-b:a', audioBitrate, '-ar', audioRate, '-ac', audioChannels);
  }

  if (outputFormat === 'mp4') {
    args.push('-movflags', '+faststart');
  }

  args.push('-y', outputPath);
  return args;
}

function buildAudioOnlyArgs(req, inputPath, outputPath, outputFormat) {
  const audioBitrate = safeValue(req.body.audioBitrateOnly, ['32k', '48k', '64k', '96k', '128k', '192k', '320k'], '128k');
  const audioChannels = safeValue(req.body.audioChannelsOnly, ['1', '2'], '2');
  const audioRate = safeValue(req.body.audioRateOnly, ['22050', '32000', '44100', '48000'], '44100');

  const args = ['-i', inputPath, '-vn'];

  if (outputFormat === 'wav') {
    args.push('-c:a', 'pcm_s16le', '-ar', audioRate, '-ac', audioChannels);
  } else if (outputFormat === 'm4a') {
    args.push('-c:a', 'aac', '-b:a', audioBitrate, '-ar', audioRate, '-ac', audioChannels);
  } else {
    args.push('-c:a', 'libmp3lame', '-b:a', audioBitrate, '-ar', audioRate, '-ac', audioChannels);
  }

  args.push('-y', outputPath);
  return args;
}

function buildCommand(req, file) {
  const mode = req.body.mainMode || 'video';
  const parsedName = path.parse(file.filename).name;
  const inputPath = file.path;

  let outputFileName = '';
  let args = [];

  if (mode === 'audio-only') {
    const outputFormat = safeValue(req.body.audioOutputFormat, ['mp3', 'm4a', 'wav'], 'mp3');
    outputFileName = 'audio-' + parsedName + '.' + outputFormat;
    const outputPath = path.join(outputsDir, outputFileName);
    args = buildAudioOnlyArgs(req, inputPath, outputPath, outputFormat);
  } else {
    const outputFormat = safeValue(req.body.videoOutputFormat, ['mp4', 'mkv'], 'mp4');
    outputFileName = 'video-' + parsedName + '.' + outputFormat;
    const outputPath = path.join(outputsDir, outputFileName);
    args = buildVideoArgs(req, inputPath, outputPath, outputFormat);
  }

  return { args, outputFileName };
}

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FFmpeg avanzado tamaño video/audio</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      background: #f4f6f8;
      padding: 24px;
      margin: 0;
    }
    .box {
      max-width: 980px;
      margin: 20px auto;
      background: white;
      padding: 24px;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.08);
    }
    h1, h2, h3 {
      color: #1565C0;
      margin-top: 0;
    }
    p, label {
      color: #444;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
    }
    input, select, button {
      width: 100%;
      padding: 12px;
      margin-top: 6px;
      font-size: 15px;
      box-sizing: border-box;
    }
    button {
      background: #1565C0;
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      margin-top: 16px;
    }
    button:hover {
      background: #0d47a1;
    }
    button:disabled {
      background: #90a4ae;
      cursor: not-allowed;
    }
    .section {
      border: 1px solid #e0e0e0;
      border-radius: 10px;
      padding: 16px;
      margin-top: 16px;
    }
    .status {
      margin-top: 15px;
      padding: 12px;
      border-radius: 8px;
      background: #e3f2fd;
      color: #0d47a1;
      display: none;
    }
    .result {
      margin-top: 20px;
      padding: 16px;
      background: #f1f8e9;
      border-radius: 8px;
    }
    .error {
      margin-top: 20px;
      padding: 16px;
      background: #ffebee;
      border-radius: 8px;
      color: #b71c1c;
      white-space: pre-wrap;
    }
    .hidden {
      display: none;
    }
    .note {
      font-size: 13px;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="box">
    <h1>FFmpeg avanzado para tamaño de video y audio</h1>
    <p>Versión estable con envío normal del formulario.</p>

    <form id="uploadForm" action="/convert" method="post" enctype="multipart/form-data">
      <label>Archivo</label>
      <input type="file" id="video" name="video" accept="video/*,audio/*" required>

      <div class="section">
        <h3>Tipo de proceso</h3>
        <select id="mainMode" name="mainMode">
          <option value="video">Video / video+audio</option>
          <option value="audio-only">Solo audio</option>
        </select>
      </div>

      <div class="section" id="videoSection">
        <h3>Salida de video</h3>
        <div class="grid">
          <div>
            <label>Formato de salida</label>
            <select name="videoOutputFormat">
              <option value="mp4">MP4</option>
              <option value="mkv">MKV</option>
            </select>
          </div>
          <div>
            <label>Códec de video</label>
            <select name="videoCodec">
              <option value="libx264">H.264 / AVC</option>
              <option value="libx265">H.265 / HEVC</option>
              <option value="none">Sin video</option>
            </select>
          </div>
          <div>
            <label>Modo de control tamaño</label>
            <select id="qualityMode" name="qualityMode">
              <option value="crf">CRF</option>
              <option value="bitrate">Bitrate fijo / controlado</option>
            </select>
          </div>
          <div>
            <label>CRF</label>
            <select name="crf">
              <option value="18">18 - Muy alta calidad</option>
              <option value="20">20 - Alta calidad</option>
              <option value="23">23 - Default típico</option>
              <option value="28" selected>28 - Comprimido</option>
              <option value="30">30 - Muy comprimido</option>
              <option value="35">35 - Ultra comprimido</option>
              <option value="40">40 - Extremo</option>
              <option value="45">45 - Máximo ahorro</option>
            </select>
          </div>
          <div>
            <label>Preset velocidad</label>
            <select name="encodePreset">
              <option value="ultrafast">ultrafast</option>
              <option value="superfast">superfast</option>
              <option value="veryfast">veryfast</option>
              <option value="faster">faster</option>
              <option value="fast">fast</option>
              <option value="medium" selected>medium</option>
              <option value="slow">slow</option>
            </select>
          </div>
          <div>
            <label>Resolución</label>
            <select name="resolution">
              <option value="source">Original</option>
              <option value="1920:1080">1080p</option>
              <option value="1280:720">720p</option>
              <option value="854:480">480p</option>
              <option value="640:360">360p</option>
            </select>
          </div>
          <div>
            <label>FPS</label>
            <select name="fps">
              <option value="source">Original</option>
              <option value="60">60</option>
              <option value="30">30</option>
              <option value="24">24</option>
              <option value="15">15</option>
            </select>
          </div>
        </div>

        <div class="grid hidden" style="margin-top:12px;" id="bitrateSection">
          <div>
            <label>Video bitrate</label>
            <select name="videoBitrate">
              <option value="300k">300k</option>
              <option value="500k">500k</option>
              <option value="800k">800k</option>
              <option value="1000k" selected>1000k</option>
              <option value="1500k">1500k</option>
              <option value="2000k">2000k</option>
              <option value="3000k">3000k</option>
              <option value="5000k">5000k</option>
            </select>
          </div>
          <div>
            <label>Maxrate</label>
            <select name="maxrate">
              <option value="none" selected>No usar</option>
              <option value="500k">500k</option>
              <option value="800k">800k</option>
              <option value="1200k">1200k</option>
              <option value="1500k">1500k</option>
              <option value="2500k">2500k</option>
              <option value="4000k">4000k</option>
              <option value="6000k">6000k</option>
            </select>
          </div>
          <div>
            <label>Minrate</label>
            <select name="minrate">
              <option value="none" selected>No usar</option>
              <option value="300k">300k</option>
              <option value="500k">500k</option>
              <option value="800k">800k</option>
              <option value="1000k">1000k</option>
              <option value="1500k">1500k</option>
              <option value="2500k">2500k</option>
            </select>
          </div>
          <div>
            <label>Bufsize</label>
            <select name="bufsize">
              <option value="none" selected>No usar</option>
              <option value="500k">500k</option>
              <option value="1000k">1000k</option>
              <option value="2000k">2000k</option>
              <option value="4000k">4000k</option>
              <option value="8000k">8000k</option>
            </select>
          </div>
        </div>

        <h3 style="margin-top:16px;">Audio dentro del video</h3>
        <div class="grid">
          <div>
            <label>Códec de audio</label>
            <select name="audioCodec">
              <option value="aac">AAC</option>
              <option value="libmp3lame">MP3</option>
              <option value="pcm_s16le">WAV PCM</option>
              <option value="copy">Copiar audio</option>
              <option value="none">Sin audio</option>
            </select>
          </div>
          <div>
            <label>Bitrate audio</label>
            <select name="audioBitrate">
              <option value="32k">32k</option>
              <option value="48k">48k</option>
              <option value="64k">64k</option>
              <option value="96k">96k</option>
              <option value="128k" selected>128k</option>
              <option value="192k">192k</option>
              <option value="320k">320k</option>
            </select>
          </div>
          <div>
            <label>Canales</label>
            <select name="audioChannels">
              <option value="1">Mono</option>
              <option value="2" selected>Stereo</option>
            </select>
          </div>
          <div>
            <label>Frecuencia</label>
            <select name="audioRate">
              <option value="22050">22050 Hz</option>
              <option value="32000">32000 Hz</option>
              <option value="44100" selected>44100 Hz</option>
              <option value="48000">48000 Hz</option>
            </select>
          </div>
        </div>
      </div>

      <div class="section hidden" id="audioSection">
        <h3>Salida solo audio</h3>
        <div class="grid">
          <div>
            <label>Formato salida audio</label>
            <select name="audioOutputFormat">
              <option value="mp3">MP3</option>
              <option value="m4a">M4A / AAC</option>
              <option value="wav">WAV</option>
            </select>
          </div>
          <div>
            <label>Bitrate audio</label>
            <select name="audioBitrateOnly">
              <option value="32k">32k</option>
              <option value="48k">48k</option>
              <option value="64k">64k</option>
              <option value="96k">96k</option>
              <option value="128k" selected>128k</option>
              <option value="192k">192k</option>
              <option value="320k">320k</option>
            </select>
          </div>
          <div>
            <label>Canales</label>
            <select name="audioChannelsOnly">
              <option value="1">Mono</option>
              <option value="2" selected>Stereo</option>
            </select>
          </div>
          <div>
            <label>Frecuencia</label>
            <select name="audioRateOnly">
              <option value="22050">22050 Hz</option>
              <option value="32000">32000 Hz</option>
              <option value="44100" selected>44100 Hz</option>
              <option value="48000">48000 Hz</option>
            </select>
          </div>
        </div>
      </div>

      <button type="submit" id="submitBtn">Procesar archivo</button>

      <div class="status" id="statusBox">
        El archivo se está subiendo y procesando. Espera por favor...
      </div>

      <p class="note">Esta versión usa envío tradicional del formulario para mayor estabilidad.</p>
    </form>
  </div>

  <script>
    const form = document.getElementById('uploadForm');
    const mainMode = document.getElementById('mainMode');
    const videoSection = document.getElementById('videoSection');
    const audioSection = document.getElementById('audioSection');
    const qualityMode = document.getElementById('qualityMode');
    const bitrateSection = document.getElementById('bitrateSection');
    const submitBtn = document.getElementById('submitBtn');
    const statusBox = document.getElementById('statusBox');
    const videoInput = document.getElementById('video');

    function refreshMainMode() {
      if (mainMode.value === 'audio-only') {
        videoSection.classList.add('hidden');
        audioSection.classList.remove('hidden');
      } else {
        videoSection.classList.remove('hidden');
        audioSection.classList.add('hidden');
      }
    }

    function refreshQualityMode() {
      if (qualityMode.value === 'bitrate') {
        bitrateSection.classList.remove('hidden');
      } else {
        bitrateSection.classList.add('hidden');
      }
    }

    mainMode.addEventListener('change', refreshMainMode);
    qualityMode.addEventListener('change', refreshQualityMode);

    refreshMainMode();
    refreshQualityMode();

    form.addEventListener('submit', function () {
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
  try {
    if (!req.file) {
      return res.status(400).send(`
        <div style="font-family:Arial;padding:30px;">
          <h2>Error</h2>
          <p>No se subió ningún archivo.</p>
          <p><a href="/">Volver</a></p>
        </div>
      `);
    }

    const { args, outputFileName } = buildCommand(req, req.file);
    const ffmpeg = spawn('ffmpeg', args);
    let errorOutput = '';

    ffmpeg.stderr.on('data', (data) => {
      errorOutput += data.toString();
      console.log(data.toString());
    });

    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        return res.status(500).send(`
          <div style="font-family:Arial;padding:30px;">
            <h2>Error al procesar el archivo</h2>
            <pre style="white-space:pre-wrap;">${errorOutput || 'Error desconocido.'}</pre>
            <p><a href="/">Volver</a></p>
          </div>
        `);
      }

      return res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Proceso completado</title>
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
    <h2>Proceso completado</h2>
    <p>Tu archivo ya está listo.</p>
    <a class="button" href="/outputs/${outputFileName}" download>Descargar resultado</a>
    <br>
    <a class="link" href="/">Volver</a>
  </div>
</body>
</html>
      `);
    });

    ffmpeg.on('error', (err) => {
      return res.status(500).send(`
        <div style="font-family:Arial;padding:30px;">
          <h2>Error al ejecutar FFmpeg</h2>
          <pre style="white-space:pre-wrap;">${err.message}</pre>
          <p><a href="/">Volver</a></p>
        </div>
      `);
    });
  } catch (err) {
    return res.status(400).send(`
      <div style="font-family:Arial;padding:30px;">
        <h2>Error</h2>
        <pre style="white-space:pre-wrap;">${err.message}</pre>
        <p><a href="/">Volver</a></p>
      </div>
    `);
  }
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).send(`
      <div style="font-family:Arial;padding:30px;">
        <h2>Error de subida</h2>
        <pre style="white-space:pre-wrap;">${err.message}</pre>
        <p><a href="/">Volver</a></p>
      </div>
    `);
  }

  if (err) {
    return res.status(500).send(`
      <div style="font-family:Arial;padding:30px;">
        <h2>Error del servidor</h2>
        <pre style="white-space:pre-wrap;">${err.message}</pre>
        <p><a href="/">Volver</a></p>
      </div>
    `);
  }

  next();
});

const PORT = process.env.PORT || 80;
app.listen(PORT, function () {
  console.log('Servidor corriendo en puerto ' + PORT);
});
