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

    // --- CASO 2: Petición del Asistente de Voz (CON FECHA DE HOY) ---
    if (body.userText) {
        try {
            // --- OBTENEMOS LA FECHA ACTUAL ---
            const today = new Date().toISOString().split('T')[0]; // Formato YYYY-MM-DD

            // --- NUEVO PROMPT CON FECHA DE REFERENCIA ---
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: `Eres un asistente de calendario experto. La fecha de hoy es ${today}. El usuario siempre te habla para crear eventos. Tu tarea es interpretar su lenguaje natural y extraer la información necesaria para crear un evento en Google Calendar. Calcula todas las fechas relativas como "mañana", "próximo viernes", etc., basándote en que hoy es ${today}. Devuelve ÚNICAMENTE un objeto JSON con la siguiente estructura:
                        {
                          "is_recurring": (booleano, true si es un evento recurrente como "todos los viernes"),
                          "summary": (string, la descripción del evento),
                          "start_datetime": (string, la fecha y hora de inicio en formato YYYY-MM-DDTHH:MM:SS),
                          "timezone": (string, "Europe/Madrid" por defecto),
                          "recurrence": (objeto o null. Si es recurrente, un objeto con "frequency" ("DAILY", "WEEKLY", "MONTHLY") y "day_of_week" ("MONDAY", "FRIDAY", etc.). Si no es recurrente, null)
                        }
                        Ejemplo: "mañana a las 8" -> { "is_recurring": false, "summary": "mañana a las 8", "start_datetime": "2024-10-27T08:00:00", "recurrence": null }`
                    },
                    { role: 'user', content: body.userText }
                ],
                response_format: { type: 'json_object' }
            });
            const aiResponse = JSON.parse(completion.choices[0].message.content);

            // --- Validación ---
            if (!aiResponse.summary) {
                return res.status(400).json({ success: false, error: 'La IA no pudo entender un evento claro.' });
            }
            if (!aiResponse.start_datetime) {
                return res.status(400).json({ success: false, error: 'La IA no proporcionó una fecha y hora válidas.' });
            }
            if (!body.token) {
                return res.status(400).json({ success: false, error: 'No se proporcionó token de Google.' });
            }

            // --- Lógica para crear el evento ---
            const event = {
                summary: aiResponse.summary,
                start: {
                    dateTime: aiResponse.start_datetime,
                    timeZone: aiResponse.timezone,
                },
                end: {
                    dateTime: new Date(new Date(aiResponse.start_datetime).getTime() + 60 * 60 * 1000).toISOString(),
                    timeZone: aiResponse.timezone,
                },
            };

            if (aiResponse.is_recurring && aiResponse.recurrence) {
                let rrule = `RRULE:FREQ=${aiResponse.recurrence.frequency}`;
                if (aiResponse.recurrence.day_of_week) {
                    rrule += `;BYDAY=${aiResponse.recurrence.day_of_week.slice(0, 2).toUpperCase()}`;
                }
                event.recurrence = [rrule];
            }

            console.log('Enviando evento a Google Calendar:', JSON.stringify(event, null, 2));

            const calendarResponse = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${body.token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(event),
            });

            if (!calendarResponse.ok) {
                const errorBody = await calendarResponse.text();
                console.error('Error de Google Calendar API:', calendarResponse.status, errorBody);
                return res.status(500).json({ 
                    success: false, 
                    error: `Error de Google Calendar: ${calendarResponse.status}. Detalles: ${errorBody}` 
                });
            }

            const createdEvent = await calendarResponse.json();
            return res.status(200).json({ success: true, message: `Evento "${createdEvent.summary}" creado.` });

        } catch (error) {
            console.error('Error en el backend:', error);
            return res.status(500).json({ success: false, error: error.message });
        }
    }

    return res.status(400).json({ error: 'Petición no válida' });
}
