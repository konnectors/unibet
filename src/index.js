process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://e7e51ef7c7ac4883a7c065e4682dedde:a55b128e48e24d78bcca49b8027c6bcf@sentry.cozycloud.cc/71'

const {
  BaseKonnector,
  requestFactory,
  saveBills,
  addData,
  hydrateAndFilter,
  log,
  errors,
  createCozyPDFDocument,
  htmlToPDF
} = require('cozy-konnector-libs')
const request = requestFactory({
  debug: false,
  cheerio: false,
  json: true,
  jar: true
})
const moment = require('moment')
const cheerio = require('cheerio')

const baseUrl = 'https://www.unibet.fr'
const loginUrl = baseUrl + '/zones/loginbox/processLogin.json'
const transUrl = baseUrl + '/zones/myaccount/transactions-history-result.json'
const betsUrl = baseUrl + '/zones/myaccount/betting-history-result.json'

module.exports = new BaseKonnector(start)

async function start(fields) {
  const dob = moment(fields.dob, 'YYYY-MM-DD').format('DD/MM/YYYY')
  log('info', 'Authenticating ...')
  await authenticate(fields.login, fields.password, dob)
  log('info', 'Successfully logged in')
  log('info', 'Fetching deposits ...')
  const entries = await parseDeposits()
  log('info', 'Saving deposits')
  await saveBills(entries, fields.folderPath, {
    identifiers: ['unibet'],
    contentType: 'application/pdf'
  })
  log('info', 'Fetching sport bets ...')
  // Horse bets and poker managed separatly.
  const bets = await parseBets()
  log('info', 'Saving bets')
  const betsToSave = await hydrateAndFilter(bets, 'com.unibet.bets', {
    keys: ['idfobet']
  })
  await addData(betsToSave, 'com.unibet.bets')
}

// Known API:
// url: .../transactions-history-result.json
// filter: ['deposit', 'withdraw']
// SPORT BETS
async function getTransactions(filter) {
  // Get page after page by 100 (maximum)
  let list = []
  let page = 1
  let again = true
  while (again) {
    const res = await request({
      url: transUrl,
      method: 'POST',
      form: {
        datepickerFrom: '01/01/1997',
        datepickerTo: moment().format('DD/MM/YYYY'),
        pageNumber: page,
        resultPerPage: 100,
        statusFilter: filter,
        isFreeAccount: false
      }
    })
    // Eliminate empty last page if needed
    if (res.transactionsHistoryItems) {
      list = list.concat(res.transactionsHistoryItems)
    }
    if (res.phHasNext === false) {
      again = false
    } else {
      page++
    }
  }
  return list
}

async function parseDeposits() {
  const items = await getTransactions('deposit')
  let entries = []
  for (let i in items) {
    const date = moment(items[i].date)
    const html =
      '<body><table>' +
      `<tr><td><b>Description :</b></td><td>${items[i].description}</td></tr>` +
      `<tr><td><b>Montant :</b></td><td>${items[i].amount} €</td></tr>` +
      `<tr><td><b>Date :</b></td><td>${date.format(
        'DD-MM-YYYY à HH:mm'
      )}</td></tr>` +
      '</table></body>'
    entries.push({
      vendor: 'Unibet',
      date: date.toDate(),
      amount: items[i].amount,
      currency: 'EUR',
      filename:
        `${date.format('YYYY-MM-DD')}_${items[i].amount}€` +
        `_${items[i].description.replace(' ', '')}.pdf`,
      filestream: generatePDF(
        html,
        'https://www.unibet.fr/myaccount-transactions-history.do'
      )
    })
  }
  return entries
}

// Known API:
// url: .../betting-history-result.json
// filter: ['all']
async function getBets() {
  // Get page after page by 99 (maximum)
  let list = []
  let page = 1
  let again = true
  while (again) {
    const res = await request({
      url: betsUrl,
      method: 'POST',
      form: {
        datepickerFrom: '01/01/1997',
        datepickerTo: moment().format('DD/MM/YYYY'),
        pageNumber: page,
        resultPerPage: 99,
        statusFilter: 'all',
        isFreeAccount: false
      }
    })
    // Eliminate empty last page if needed
    if (res.bettingHistoryItems) {
      list = list.concat(res.bettingHistoryItems)
    }
    if (res.phHasNext === false) {
      again = false
    } else {
      page++
    }
  }
  return list
}

async function parseBets() {
  const bets = await getBets()
  log('info', `${bets.length} bets found.`)
  return bets
}

function generatePDF(html, url) {
  const $ = cheerio.load(html)
  let doc = createCozyPDFDocument(
    'Généré automatiquement par le connecteur Unibet depuis la page',
    url
  )
  htmlToPDF($, doc, $('body'), {})
  doc.end()
  return doc
}

async function authenticate(username, password, dateOfBirth) {
  const res = await request({
    url: loginUrl,
    method: 'POST',
    form: {
      username,
      password,
      dateOfBirth
    },
    resolveWithFullResponse: true
  })
  // Test vendor
  if (res.statusCode != 200) {
    throw new Error(errors.VENDOR_DOWN)
  }
  // Test login
  if (res.body.errorMessage || !res.body.accountNumber) {
    throw new Error(errors.LOGIN_FAILED)
  }
}
