import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const cfg=window.MARIA_CFO_CONFIG||{};
export const configured=Boolean(cfg.supabaseUrl&&cfg.supabasePublishableKey);
export const supabase=configured?createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}):null;
export function configurationMessage(){ return 'أكمل config.js بوضع Supabase Project URL وPublishable Key فقط، ثم أعد تحميل الصفحة.'; }
