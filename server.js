const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const uploadsDir = path.join(__dirname, 'uploads');
const outputsDir = path.join(__dirname, 'outputs');

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
if (!fs.existsSync(outputsDir)) fs.mkdirSync(outputsDir);

app.get('/', (req, res) => {
  res.send('Servidor FFmpeg activo');
});

app.post('/convert', (req, res) => {
  const input = req.body.input || 'uploads/input.mp4';
  const output = req.body.output || 'outputs/output.mp4';

  const command = `ffmpeg -i ${input} -c:v libx264 -preset veryfast -crf 28 -c:a aac -b:a 128k ${output} -y`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({
        ok: false,
        error: stderr || error.message
      });
    }

    res.json({
      ok: true,
      message: 'Conversión completada',
      output
    });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});