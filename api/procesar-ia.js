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

    // --- CASO 2: Petición del Asistente de Voz (MÁS INTELIGENTE) ---
    if (body.userText) {
        try {
            // --- NUEVO PROMPT MÁS PODEROSO ---
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: `Eres un asistente experto en calendarización. Analiza el texto del usuario y extrae la información para crear un evento de calendario. Devuelve ÚNICAMENTE un objeto JSON con la siguiente estructura:
                        {
                          "is_recurring": (booleano, true si es un evento recurrente como "todos los viernes"),
                          "summary": (string, la descripción del evento),
                          "start_datetime": (string, la fecha y hora de inicio en formato YYYY-MM-DDTHH:MM:SS, calculando "mañana", "próximo viernes", etc.),
                          "timezone": (string, "Europe/Madrid" por defecto),
                          "recurrence": (objeto o null. Si es recurrente, un objeto con "frequency" ("DAILY", "WEEKLY", "MONTHLY") y "day_of_week" ("MONDAY", "FRIDAY", etc.). Si no es recurrente, null)
                        }
                        Ejemplo: "recuérdame todos los viernes a las 10 mandar un correo" -> { "is_recurring": true, "summary": "mandar un correo", ... "recurrence": {"frequency": "WEEKLY", "day_of_week": "FRIDAY"} }`
                    },
                    { role: 'user', content: body.userText }
                ],
                response_format: { type: 'json_object' }
            });
            const aiResponse = JSON.parse(completion.choices[0].message.content);

            // Si la IA no reconoce una acción de crear, salimos.
            if (!aiResponse.summary) {
                return res.status(200).json({ success: false, error: 'No se reconoció una acción de crear o recordar.' });
            }

            if (!body.token) {
                return res.status(400).json({ success: false, error: 'No se proporcionó token de Google.' });
            }

            // --- LÓGICA PARA CREAR EL EVENTO EN GOOGLE CALENDAR ---
            const event = {
                summary: aiResponse.summary,
                start: {
                    dateTime: aiResponse.start_datetime,
                    timeZone: aiResponse.timezone,
                },
                // Hacemos que el evento dure 1 hora por defecto
                end: {
                    dateTime: new Date(new Date(aiResponse.start_datetime).getTime() + 60 * 60 * 1000).toISOString(),
                    timeZone: aiResponse.timezone,
                },
            };

            // --- NUEVO: AÑADIMOS LA RECURRENCIA SI ES NECESARIO ---
            if (aiResponse.is_recurring && aiResponse.recurrence) {
                let rrule = `RRULE:FREQ=${aiResponse.recurrence.frequency}`;
                if (aiResponse.recurrence.day_of_week) {
                    // Google Calendar usa las dos primeras letras en inglés, ej: MO, TU, FR
                    rrule += `;BYDAY=${aiResponse.recurrence.day_of_week.slice(0, 2).toUpperCase()}`;
                }
                event.recurrence = [rrule];
            }

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
            const successMessage = aiResponse.is_recurring 
                ? `Evento recurrente "${createdEvent.summary}" creado en tu calendario.`
                : `Evento "${createdEvent.summary}" creado en tu calendario.`;

            return res.status(200).json({ success: true, message: successMessage });

        } catch (error) {
            console.error('Error en el backend:', error);
            return res.status(500).json({ success: false, error: error.message });
        }
    }

    return res.status(400).json({ error: 'Petición no válida' });
}
