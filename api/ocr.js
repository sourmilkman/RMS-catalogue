const allowedOrigins = new Set([
  'https://sourmilkman.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
])

const prompt = `Read this handwritten RMS exhibition entry schedule. Return JSON only with keys fullName, email, address, phone, societyInitials, artworks. Each artwork must have title, medium, dimensions, price, decision. decision is included for A, excluded for X, otherwise undecided. Do not invent unreadable values; use empty strings. Preserve all artwork rows containing handwriting.`

function setCors(request, response) {
  const origin = request.headers.origin
  if (allowedOrigins.has(origin)) response.setHeader('Access-Control-Allow-Origin', origin)
  response.setHeader('Vary', 'Origin')
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

export default async function handler(request, response) {
  setCors(request, response)
  if (request.method === 'OPTIONS') return response.status(204).end()
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' })
  if (!allowedOrigins.has(request.headers.origin)) return response.status(403).json({ error: 'This OCR service is only available from the RMS Catalogue app.' })

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return response.status(503).json({ error: 'Online OCR is not configured.' })

  const { data, mimeType, membershipType } = request.body ?? {}
  if (typeof data !== 'string' || !data || data.length > 20_000_000) return response.status(400).json({ error: 'Choose a valid form scan under 15 MB.' })
  if (typeof mimeType !== 'string' || !/^(image\/|application\/pdf$)/.test(mimeType)) return response.status(400).json({ error: 'Only image and PDF form scans are supported.' })

  try {
    const geminiResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType, data } }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    })
    if (!geminiResponse.ok) {
      console.error('Gemini OCR failed', geminiResponse.status, await geminiResponse.text())
      return response.status(502).json({ error: 'Google could not read this form. Try a clearer scan or use Offline OCR.' })
    }
    const result = await geminiResponse.json()
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) return response.status(502).json({ error: 'Google returned no readable form data.' })
    const draft = JSON.parse(text)
    return response.status(200).json({ ...draft, membershipType })
  } catch (error) {
    console.error('OCR proxy error', error)
    return response.status(500).json({ error: 'Online OCR failed unexpectedly. Try again or use Offline OCR.' })
  }
}
