import { OpenAI } from 'openai';
import { OAuth2Client } from 'google-auth-library';

// Configuración de clientes
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export default async function handler(req, res) {
  // Cabeceras CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // --- NUEVO: LÓGICA DE VERIFICACIÓN ---
  if (req.body && req.body.token) {
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: req.body.token,
        audience: process.env.GOOGLE_CLIENT_ID, // El ID de cliente de tu app
      });
      const payload = ticket.getPayload();
      console.log('Usuario verificado:', payload.email);
      
      // Si el token es válido, respondemos con un 200 y los datos del usuario.
      // El frontend usará esta respuesta para saber que el login fue exitoso.
      return res.status(200).json({ message: 'Login exitoso', user: payload.email });

    } catch (error) {
      console.error('Error al verificar el token:', error);
      return res.status(401).json({ error: 'Token inválido' });
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
        { role: "system", content: `Eres un asistente experto en extraer información...` },
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
