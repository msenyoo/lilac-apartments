import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Caller auth — verify they are admin
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: roleRow } = await callerClient.from('user_roles').select('role').eq('user_id', (await callerClient.auth.getUser()).data.user?.id ?? '').maybeSingle()
    if (roleRow?.role !== 'admin') return new Response(JSON.stringify({ error: 'Forbidden: admin only' }), { status: 403, headers: corsHeaders })

    // Parse body
    const { name, mobile, password, role } = await req.json()
    if (!mobile || !password || !role) return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400, headers: corsHeaders })
    if (!['admin', 'committee', 'auditor'].includes(role)) return new Response(JSON.stringify({ error: 'Invalid role' }), { status: 400, headers: corsHeaders })

    const email = `${mobile.replace(/\D/g, '')}@lilac.com`

    // Admin client (service role) to create user
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name },
    })
    if (createError) return new Response(JSON.stringify({ error: createError.message }), { status: 400, headers: corsHeaders })

    const userId = newUser.user!.id

    // Create profile
    await adminClient.from('profiles').upsert({ id: userId, mobile: mobile.replace(/\D/g, ''), display_name: name, full_name: name })

    // Assign role
    await adminClient.from('user_roles').upsert({ user_id: userId, role })

    return new Response(JSON.stringify({ id: userId, email }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})
