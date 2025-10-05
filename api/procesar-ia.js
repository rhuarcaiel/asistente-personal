import { OpenAI } from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function (req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

    let body;
    try { const chunks = []; for await (const chunk of req) chunks.push(chunk); body = JSON.parse(Buffer.concat(chunks).toString()); } catch { return res.status(400).json({ error: 'JSON inválido' }); }

    // --- CASO 1: Petición de Login ---
    if (body.action === 'login' && body.token) {
        try {
            const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${body.token}` } });
            if (!userInfoResponse.ok) throw new Error('Token inválido');
            const userInfo = await userInfoResponse.json();
            return res.status(200).json({ message: 'Login correcto', user: userInfo.email });
        } catch (error) { return res.status(401).json({ success: false, error: 'Token de acceso inválido' }); }
    }

    // --- CASO 2: Propuesta de Acción ---
    if (body.action === 'propose' && body.userText) {
        try {
            const today = new Date().toISOString().split('T')[0];
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'system', content: `Eres un asistente de calendario experto. La fecha de hoy es ${today}. El usuario te pide que hagas algo. Analiza su petición y determina si es para CREAR un evento o ELIMINAR uno. Devuelve ÚNICAMENTE un objeto JSON con esta estructura: { "intent": ("create" o "delete"), "summary": (string), "start_datetime": (string, YYYY-MM-DDTHH:MM:SS), "is_recurring": (booleano), "recurrence": (objeto o null), "timezone": (string, "Europe/Madrid") }` }, { role: 'user', content: body.userText }],
                response_format: { type: 'json_object' }
            });
            const proposal = JSON.parse(completion.choices[0].message.content);
            return res.status(200).json({ success: true, proposal });
        } catch (error) { return res.status(500).json({ success: false, error: 'Error al procesar la petición con la IA.' }); }
    }

    // --- CASO 3: Ejecución de la Acción ---
    if (body.action === 'execute' && body.proposal && body.token) {
        const proposal = body.proposal; const token = body.token;
        if (proposal.intent === 'create') {
            const event = { summary: proposal.summary, start: { dateTime: proposal.start_datetime, timeZone: proposal.timezone }, end: { dateTime: new Date(new Date(proposal.start_datetime).getTime() + 60 * 60 * 1000).toISOString(), timeZone: proposal.timezone } };
            if (proposal.is_recurring && proposal.recurrence) { let rrule = `RRULE:FREQ=${proposal.recurrence.frequency}`; if (proposal.recurrence.day_of_week) rrule += `;BYDAY=${proposal.recurrence.day_of_week.slice(0, 2).toUpperCase()}`; event.recurrence = [rrule]; }
            const calendarResponse = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(event) });
            if (!calendarResponse.ok) { const errorBody = await calendarResponse.text(); return res.status(500).json({ success: false, error: `Error de Google Calendar: ${calendarResponse.status}. Detalles: ${errorBody}` }); }
            const createdEvent = await calendarResponse.json();
            return res.status(200).json({ success: true, message: `Evento "${createdEvent.summary}" creado.` });
        } else if (proposal.intent === 'delete') {
            const searchUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${proposal.start_datetime}&timeMax=${new Date(new Date(proposal.start_datetime).getTime() + 60*60*1000).toISOString()}`;
            const searchResponse = await fetch(searchUrl, { headers: { 'Authorization': `Bearer ${token}` } });
            const events = await searchResponse.json();
            const eventToDelete = events.items.find(e => e.summary.toLowerCase().includes(proposal.summary.toLowerCase()));
            if (!eventToDelete) return res.status(404).json({ success: false, error: 'No encontré un evento con esa descripción en esa hora.' });
            const deleteResponse = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventToDelete.id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
            if (!deleteResponse.ok) return res.status(500).json({ success: false, error: 'No se pudo eliminar el evento.' });
            return res.status(200).json({ success: true, message: `Evento "${eventToDelete.summary}" eliminado.` });
        }
    }
    return res.status(400).json({ error: 'Petición no válida.' });
}
