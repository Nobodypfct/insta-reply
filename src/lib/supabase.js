const { createClient } = require('@supabase/supabase-js');
const env = require('../config/env');

// service_role key используется только на сервере, никогда не попадает в браузер
const supabase = createClient(env.supabase.url, env.supabase.serviceRoleKey);

module.exports = supabase;
