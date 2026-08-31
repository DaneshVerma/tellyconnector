import { ledgerMenu } from './commands/ledger'

async function main() {
  console.log('Local TallyPrime Agent — Phase 1 POC')
  await ledgerMenu()
  console.log('Exiting')
}

main().catch((err) => {
  console.error('Fatal error', err)
  process.exit(1)
})
