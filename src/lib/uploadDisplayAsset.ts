import { supabase } from './supabase'

// A diferencia del único precedente existente (SpraywallPage.tsx: foto única
// 'base.jpg' con upsert:true), aquí cada fila (patrocinador o slide) tiene su
// propia imagen — nombre único por archivo, sin upsert ni cache-busting por
// query string (la URL cambia sola si la imagen cambia).
export async function uploadDisplayAsset(file: File, folder: 'sponsors' | 'slides'): Promise<string> {
  const ext = file.name.split('.').pop() || 'jpg'
  const path = `${folder}/${crypto.randomUUID()}.${ext}`

  const { error } = await supabase.storage
    .from('display-assets')
    .upload(path, file, { contentType: file.type })
  if (error) throw error

  const { data } = supabase.storage.from('display-assets').getPublicUrl(path)
  return data.publicUrl
}
