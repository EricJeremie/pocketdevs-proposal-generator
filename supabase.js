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
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.warn('Supabase session error:', error.message);
      return null;
    }
    return data?.session || null;
  } catch (err) {
    console.error('Failed to get session:', err);
    return null;
  }
}

/* ---------- Database Ops ---------- */
export async function saveProposal(proposalData) {
  try {
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
  } catch (err) {
    console.error('Save proposal failed:', err);
    return { error: err.message };
  }
}

export async function fetchUserProposals() {
  try {
    const session = await getSession();
    if (!session) return [];

    const { data, error } = await supabase
      .from('proposals')
      .select('*')
      .eq('user_id', session.user.id)
      .order('updated_at', { ascending: false });

    if (error) {
      // Check for 'relation "proposals" does not exist' which happens in fresh projects
      if (error.code === '42P01') {
        console.info('Proposals table not found yet. It will be created on the first save.');
      } else {
        console.error('Error fetching proposals:', error);
      }
      return [];
    }
    return data || [];
  } catch (err) {
    console.error('Fetch proposals exception:', err);
    return [];
  }
}
