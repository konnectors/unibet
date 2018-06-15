process.env.SENTRY_DSN = process.env.SENTRY_DSN ||
'https://e7e51ef7c7ac4883a7c065e4682dedde:a55b128e48e24d78bcca49b8027c6bcf@sentry.cozycloud.cc/71'

const {
  BaseKonnector,
  requestFactory,
  saveBills,
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

module.exports = new BaseKonnector(start)

async function start(fields) {
  log('info', 'Authenticating ...')
  await authenticate(fields.login, fields.password, fields.dob)
  log('info', 'Successfully logged in')
  log('info', 'Fetching the list of documents ...')
  const entries = await parseDeposits()
  log('info', 'Saving data to Cozy ...')
  await saveBills(entries, fields.folderPath, {
    identifiers: ['unibet']
  })
}

async function getDeposits() {
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
        statusFilter: 'deposit',
        isFreeAccount: false
      }
    })
    // Eliminate empty last page if needed
    if (res.transactionsHistoryItems) {
      list = list.concat(res.transactionsHistoryItems)
    }
    if (!res.phHasNext || res.phHasNext === false) {
      again = false
    } else {
      page++
    }
  }
  return list
}

async function parseDeposits() {
  const items = await getDeposits()
  let entries = []
  for (let i in items) {
    const date =  moment(items[i].date)
    const html = '<body><table>'+
      `<tr><td><b>Description :</b></td><td>${items[i].description}</td></tr>` +
      `<tr><td><b>Montant :</b></td><td>${items[i].amount} €</td></tr>` +
      `<tr><td><b>Date :</b></td><td>${date.format('DD-MM-YYYY à HH:mm')}</td></tr>` +
      '</table></body>'
    entries.push({
      date: date.toDate(),
      amount: items[i].amount,
      currency: 'EUR',
      filename: `${date.format('YYYY-MM-DD')}_${items[i].amount}€` +
        `_${items[i].description.replace(' ','')}.pdf`,
      filestream: generatePDF(html,
                              'https://www.unibet.fr/myaccount-transactions-history.do')
    })
  }
  return entries
}

function generatePDF(html, url) {
  $ = cheerio.load(html)
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
