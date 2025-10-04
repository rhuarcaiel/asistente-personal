export default function handler(req, res) {
  // Añadir cabeceras CORS para permitir peticiones desde cualquier origen
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5500'); // Es más seguro poner tu origen local
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle pre-flight requests for CORS
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Por ahora, este endpoint no hace nada más.
  // Más adelante, procesaremos el código de autorización de Google aquí.
  res.status(200).json({ message: 'Endpoint de callback de Google actualizado.' });
}
