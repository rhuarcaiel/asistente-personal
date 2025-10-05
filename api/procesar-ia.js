import { OpenAI } from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function (req, res) {
    // Cabeceras CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

    let body;
    try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        body = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
        return res.status(400).json({ error: 'JSON inválido' });
    }

    // --- CASO 1: Petición de Login ---
    if (body.access_token && !body.userText) {
        try {
            const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${body.access_token}` }
            });
            if (!userInfoResponse.ok) throw new Error('Token inválido');
            const userInfo = await userInfoResponse.json();
            return res.status(200).json({ message: 'Login correcto', user: userInfo.email });
        } catch (error) {
            return res.status(401).json({ success: false, error: 'Token de acceso inválido' });
        }
    }

    // --- CASO 2: Petición del Asistente de Voz ---
    if (body.userText) {
        try {
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: 'Devuelve JSON con { "accion": "...", "tarea": "...", "fecha": "...", "hora": "..." }' },
                    { role: 'user', content: body.userText }
                ],
                response_format: { type: 'json_object' }
            });
            const aiResponse = JSON.parse(completion.choices[0].message.content);

            // --- CAMBIO CLAVE AQUÍ: Añadimos "recordar" a la condición ---
            if (aiResponse.accion && (aiResponse.accion.includes('recordar') || aiResponse.accion.includes('recordatorio') || aiResponse.accion.includes('agregar') || aiResponse.accion.includes('crear'))) {
                if (!body.token) {
                    return res.status(400).json({ success: false, error: 'No se proporcionó token de Google.' });
                }

                // OJO: "mañana" no es una fecha válida. Tenemos que convertirla.
                // Por ahora, pondremos la fecha de hoy como placeholder.
                const today = new Date();
                const tomorrow = new Date(today);
                tomorrow.setDate(today.getDate() + 1);
                const formattedDate = tomorrow.toISOString().split('T')[0]; // Formato YYYY-MM-DD

                const event = {
                    summary: aiResponse.tarea,
                    start: { dateTime: `${formattedDate}T${aiResponse.hora}:00`, timeZone: 'Europe/Madrid' },
                    end: { dateTime: `${formattedDate}T${aiResponse.hora}:00`, timeZone: 'Europe/Madrid' },
                };

                const calendarResponse = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${body.token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify(event),
                });

                if (!calendarResponse.ok) {
                    const errorData = await calendarResponse.json();
                    throw new Error(`Error de Calendar: ${errorData.error.message}`);
                }

                const createdEvent = await calendarResponse.json();
                return res.status(200).json({ success: true, message: `Evento "${createdEvent.summary}" creado en tu calendario.` });

            } else {
                return res.status(200).json({ success: false, error: 'No se reconoció una acción de crear o recordar.' });
            }

        } catch (error) {
            console.error('Error en el backend:', error);
            return res.status(500).json({ success: false, error: error.message });
        }
    }

    return res.status(400).json({ error: 'Petición no válida' });
}
