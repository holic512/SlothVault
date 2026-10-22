import { Button, useRouter } from '@slothvault/plugin-sdk/client'
import { ID, useCopy } from './ui'
export default function Entry() { const c=useCopy(),router=useRouter();return <Button onClick={()=>router.push(`/account/extensions/${ID}/purchase`)}>{c.title}</Button> }
