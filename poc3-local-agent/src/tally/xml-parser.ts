import { XMLParser } from 'fast-xml-parser'

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })

export function parseXml(xml: string) {
  try {
    return { success: true, data: parser.parse(xml) }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}
