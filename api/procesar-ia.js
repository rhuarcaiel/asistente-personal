import { OpenAI } from 'openai';
import fetch from 'node-fetch'; // Importamos node-fetch

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  // Cabeceras CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // --- NUEVA LÓGICA: Verificar ACCESS_TOKEN y Acceder a Calendar ---
  if (req.body && req.body.access_token) {
    try {
      const token = req.body.access_token;

      // 1. Obtener info del usuario para verificar el token
      const userInfoResponse = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!userInfoResponse.ok) throw new Error('Token inválido al obtener userinfo.');
      const userInfo = await userInfoResponse.json();

      // 2. Verificar acceso a Calendar API (esto confirma que el scope es correcto)
      const calendarResponse = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!calendarResponse.ok) throw new Error('No se pudo acceder a Calendar API.');

      console.log('Usuario autenticado con permisos de Calendar:', userInfo.email);
      
      return res.status(200).json({
        message: 'Acceso a Calendar correcto',
        user: userInfo.email,
        access_token: token // Devolvemos el token para poder usarlo luego
      });

    } catch (error) {
      console.error('Error al verificar access_token:', error);
      return res.status(401).json({ error: 'Token de acceso inválido o expirado' });
    }
  }

  // --- LÓGICA EXISTENTE DEL ASISTENTE (si no hay token) ---
  if (req.method !== 'POST' || !req.body.userText) {
    return res.status(400).json({ error: 'Petición inválida' });
  }

  const { userText } = req.body;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", messages: [
        { role: "system", content: `Eres un asistente experto...` },
        { role: "user", content: userText }
      ], response_format: { type: "json_object" }
    });
    const aiResponse = JSON.parse(completion.choices[0].message.content);
    res.status(200).json(aiResponse);
  } catch (error) {
    console.error('Error al llamar a OpenAI:', error);
    res.status(500).json({ error: 'Fallo al procesar la solicitud con la IA' });
  }
}
