/* ============================================================
   PocketDevs Proposal Generator - Supabase Integration
   ============================================================ */
'use strict';

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const SUPABASE_URL = 'https://xiykfvyjavkkmfqujcql.supabase.co';
const SUPABASE_KEY = 'sb_publishable_CoqmS7OUcHBQ55Ho22xgyg_RYYtUoLk';
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ---------- Auth State ---------- */
export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

/* ---------- Database Ops ---------- */
export async function saveProposal(proposalData) {
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };

  const { data, error } = await supabase
    .from('proposals')
    .upsert({
      user_id: session.user.id,
      document_number: proposalData.meta.documentNumber,
      title: proposalData.meta.title,
      client_company: proposalData.client.company,
      content: proposalData,
      updated_at: new Date()
    }, {
      onConflict: 'document_number'
    });
  
  return { data, error };
}

export async function fetchUserProposals() {
  const session = await getSession();
  if (!session) return [];

  const { data, error } = await supabase
    .from('proposals')
    .select('*')
    .eq('user_id', session.user.id)
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('Error fetching proposals:', error);
    return [];
  }
  return data;
}
