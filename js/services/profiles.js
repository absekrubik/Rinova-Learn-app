import { requireClient } from '../core/supabase.js';

export async function newest(limit = 6) {
  const { data, error } = await requireClient().from('profiles')
    .select('id,full_name,email,role,status,created_at').order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data;
}

export async function updateOwn(id, { full_name, phone, bio }) {
  const { data, error } = await requireClient().from('profiles')
    .update({ full_name, phone: phone || null, bio: bio || null }).eq('id', id).select('*').single();
  if (error) throw error;
  return data;
}

export const AVATAR_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
export const AVATAR_MAX = 2 * 1024 * 1024;

/** Uploads to avatars/{userId}/..., saves the public URL on the profile, removes the old file. */
export async function uploadAvatar(userId, file, oldUrl) {
  const ext = AVATAR_TYPES[file.type];
  if (!ext) throw new Error('Please choose a PNG, JPG or WebP image.');
  if (file.size > AVATAR_MAX) throw new Error('The image must be 2 MB or smaller.');
  const sb = requireClient();
  const path = `${userId}/avatar-${Date.now()}.${ext}`;
  const { error: upErr } = await sb.storage.from('avatars').upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) throw upErr;
  const { data: pub } = sb.storage.from('avatars').getPublicUrl(path);
  const { error } = await sb.from('profiles').update({ avatar_url: pub.publicUrl }).eq('id', userId);
  if (error) throw error;
  const marker = '/avatars/';
  if (oldUrl && oldUrl.includes(marker)) await sb.storage.from('avatars').remove([oldUrl.split(marker)[1]]).catch(() => {});
  return pub.publicUrl;
}
