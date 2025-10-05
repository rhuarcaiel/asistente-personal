// api/procesar-ia.js
import { OpenAI } from 'openai';

// Vercel usa Node.js 18+ → fetch ya está disponible globalmente
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function (req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  // Leer y parsear el cuerpo de la petición
  let body;
  try {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const data = Buffer.concat(chunks).toString();
    body = JSON.parse(data || '{}');
  } catch (e) {
    return res.status(400).json({ error: 'JSON inválido' });
  }

  // --- Verificar token de Google ---
  if (body.access_token) {
    try {
      const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${body.access_token}` }
      });
      if (!userInfoResponse.ok) throw new Error('Token inválido');

      const calendarResponse = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
        headers: { Authorization: `Bearer ${body.access_token}` }
      });
      if (!calendarResponse.ok) throw new Error('Sin acceso a Calendar');

      const userInfo = await userInfoResponse.json();
      return res.status(200).json({
        message: 'Acceso a Calendar correcto',
        user: userInfo.email
      });
    } catch (error) {
      console.error('Error al verificar token:', error.message);
      return res.status(401).json({ error: 'Token inválido o sin permisos para Calendar' });
    }
  }

  // --- Procesar con OpenAI ---
  if (body.userText) {
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Eres un asistente experto que devuelve JSON con { "accion": "...", "tarea": "...", "fecha": "...", "hora": "..." }' },
          { role: 'user', content: body.userText }
        ],
        response_format: { type: 'json_object' }
      });
      const aiResponse = JSON.parse(completion.choices[0].message.content);
      return res.status(200).json(aiResponse);
    } catch (error) {
      console.error('Error OpenAI:', error);
      return res.status(500).json({ error: 'Fallo al procesar con IA' });
    }
  }

  return res.status(400).json({ error: 'Falta access_token o userText' });
}
