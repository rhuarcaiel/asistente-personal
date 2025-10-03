import { OpenAI } from 'openai';

// La configuración del cliente de OpenAI
// La API Key se cargará desde una variable de entorno en Vercel
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Esta es la función que se ejecutará cuando alguien llame a tu URL
export default async function handler(req, res) {
  // Solo aceptamos peticiones POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  // Obtenemos el texto que nos envía la app
  const { userText } = req.body;

  if (!userText) {
    return res.status(400).json({ error: 'Falta el texto del usuario' });
  }

  try {
    // Llamamos a OpenAI con el modelo gpt-4o-mini
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Eres un asistente experto en extraer información para crear recordatorios. Analiza el texto del usuario y devuelve un objeto JSON con las siguientes claves: "accion" (puede ser "crear_recordatorio" o "consultar_agenda"), "tarea" (la descripción de lo que hay que hacer), "fecha" (en formato YYYY-MM-DD, o null si no se menciona), y "hora" (en formato HH:MM, o null si no se menciona). Devuelve ÚNICAMENTE el objeto JSON, sin ningún otro texto.`
        },
        {
          role: "user",
          content: userText
        }
      ],
      // Forzamos a que la respuesta sea un JSON válido
      response_format: { type: "json_object" }
    });

    // Parseamos la respuesta de la IA y la devolvemos a nuestra app
    const aiResponse = JSON.parse(completion.choices[0].message.content);
    res.status(200).json(aiResponse);

  } catch (error) {
    console.error('Error al llamar a OpenAI:', error);
    res.status(500).json({ error: 'Fallo al procesar la solicitud con la IA' });
  }
}