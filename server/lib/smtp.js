const tls = require('tls');
const { Buffer } = require('buffer');

function sendEmail({ host, port = 465, secure = true, user, pass, from, to, subject, text = '', html = '' }) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, rejectUnauthorized: false }, () => {});
    let buf = '';
    let step = 0;
    function write(line) { socket.write(line + '\r\n'); }
    function next() {
      if (step === 0) { write('EHLO localhost'); step++; return; }
      if (step === 1) { write('AUTH LOGIN'); step++; return; }
      if (step === 2) { write(Buffer.from(user).toString('base64')); step++; return; }
      if (step === 3) { write(Buffer.from(pass).toString('base64')); step++; return; }
      if (step === 4) { write(`MAIL FROM:<${from}>`); step++; return; }
      if (step === 5) { write(`RCPT TO:<${to}>`); step++; return; }
      if (step === 6) { write('DATA'); step++; return; }
      if (step === 7) {
        const boundary = '----robotboundary' + Date.now();
        let data = '';
        data += `From: ${from}\r\n`;
        data += `To: ${to}\r\n`;
        data += `Subject: ${subject}\r\n`;
        data += 'MIME-Version: 1.0\r\n';
        data += `Content-Type: multipart/alternative; boundary=${boundary}\r\n\r\n`;
        data += `--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${text}\r\n`;
        data += `--${boundary}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${html}\r\n`;
        data += `--${boundary}--\r\n.\r\n`;
        socket.write(data);
        step++;
        return;
      }
      if (step === 8) { write('QUIT'); step++; return; }
    }
    socket.on('data', (d) => {
      buf += d.toString('utf-8');
      const lines = buf.split('\r\n').filter(Boolean);
      const last = lines[lines.length - 1] || '';
      if (/^(220|250|334|235|250 2\.1\.0|250 2\.1\.5|354|250 2\.0\.0)/.test(last)) next();
    });
    socket.on('error', reject);
    socket.on('end', () => resolve(true));
    setTimeout(() => reject(new Error('SMTP timeout')), 30000);
  });
}

module.exports = { sendEmail };
