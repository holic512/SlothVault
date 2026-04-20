import { HomePage } from '@/components/pages/home-page'
import { getHomepage } from '@/server/public/homepage'

export default async function Page() {
  const homepage = await getHomepage()
  return <HomePage content={homepage.content} />
}
