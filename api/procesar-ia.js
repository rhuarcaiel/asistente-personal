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
    if (body.action === 'login' && body.token) {
        // ... (lógica de login igual que antes) ...
        try {
            const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${body.token}` }
            });
            if (!userInfoResponse.ok) throw new Error('Token inválido');
            const userInfo = await userInfoResponse.json();
            return res.status(200).json({ message: 'Login correcto', user: userInfo.email });
        } catch (error) {
            return res.status(401).json({ success: false, error: 'Token de acceso inválido' });
        }
    }

    // --- CASO 2: Propuesta de Acción (LO NUEVO) ---
    if (body.action === 'propose' && body.userText) {
        try {
            const today = new Date().toISOString().split('T')[0];
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: `Eres un asistente de calendario experto. La fecha de hoy es ${today}. El usuario te pide que hagas algo. Analiza su petición y determina si es para CREAR un evento o ELIMINAR uno. Devuelve ÚNICAMENTE un objeto JSON con esta estructura:
                        {
                          "intent": ("create" o "delete"),
                          "summary": (string, la descripción del evento),
                          "start_datetime": (string, la fecha y hora de inicio en formato YYYY-MM-DDTHH:MM:SS),
                          "is_recurring": (booleano),
                          "recurrence": (objeto o null, igual que antes),
                          "timezone": (string, "Europe/Madrid")
                        }
                        Si es para eliminar, intenta encontrar la fecha y hora exactas que menciona el usuario.`
                    },
                    { role: 'user', content: body.userText }
                ],
                response_format: { type: 'json_object' }
            });
            const proposal = JSON.parse(completion.choices[0].message.content);
            return res.status(200).json({ success: true, proposal });

        } catch (error) {
            return res.status(500).json({ success: false, error: 'Error al procesar la petición con la IA.' });
        }
    }

    // --- CASO 3: Ejecución de la Acción (LO NUEVO) ---
    if (body.action === 'execute' && body.proposal && body.token) {
        const proposal = body.proposal;
        const token = body.token;

        if (proposal.intent === 'create') {
            // Lógica para CREAR el evento (igual que antes)
            const event = { /* ... lógica de creación del evento ... */ };
            if (proposal.is_recurring && proposal.recurrence) { /* ... lógica de recurrencia ... */ }
            
            const calendarResponse = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
                method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(event)
            });
            if (!calendarResponse.ok) { /* ... manejo de error ... */ }
            return res.status(200).json({ success: true, message: `Evento "${proposal.summary}" creado.` });

        } else if (proposal.intent === 'delete') {
            // Lógica para ELIMINAR el evento
            // 1. Buscar el evento en Google Calendar
            const searchUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${proposal.start_datetime}&timeMax=${new Date(new Date(proposal.start_datetime).getTime() + 60*60*1000).toISOString()}`;
            const searchResponse = await fetch(searchUrl, { headers: { 'Authorization': `Bearer ${token}` } });
            const events = await searchResponse.json();
            const eventToDelete = events.items.find(e => e.summary.toLowerCase().includes(proposal.summary.toLowerCase()));

            if (!eventToDelete) {
                return res.status(404).json({ success: false, error: 'No encontré un evento con esa descripción en esa hora.' });
            }
            
            // 2. Eliminar el evento encontrado
            const deleteResponse = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventToDelete.id}`, {
                method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!deleteResponse.ok) { /* ... manejo de error ... */ }
            return res.status(200).json({ success: true, message: `Evento "${eventToDelete.summary}" eliminado.` });
        }
    }

    return res.status(400).json({ error: 'Petición no válida.' });
}
