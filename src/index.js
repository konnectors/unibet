const {
  BaseKonnector,
  requestFactory,
  signin,
  scrape,
  saveBills,
  log
} = require('cozy-konnector-libs')
const request = requestFactory({
  debug: true,
  cheerio: false,
  json: true,
  jar: true
})

const baseUrl = 'https://www.unibet.fr/pari-sportif-poker'
const loginUrl = 'https://www.unibet.fr/zones/loginbox/processLogin.json'

module.exports = new BaseKonnector(start)

async function start(fields) {
  log('info', 'Authenticating ...')
  await authenticate(fields.login, fields.password, fields.dateOfBirth)
  log('info', 'Successfully logged in')
  await getDeposits()
  //  const $ = await request('https://www.unibet.fr/pari-sportif-poker')
  // console.log($.html())

  //const $2 = await request('https://www.unibet.fr/myaccount-betting-history.do')

  return

  log('info', 'Fetching the list of documents')
  //  const $ = await request(`${baseUrl}/index.html`)
  log('info', 'Parsing list of documents')
  //  const documents = await parseDocuments($)

  log('info', 'Saving data to Cozy')
  await saveBills(documents, fields.folderPath, {
    identifiers: ['books']
  })
}

async function getDeposits() {
  const res = await request({
    url:
      'https://www.unibet.fr/zones/myaccount/transactions-history-result.json',
    method: 'POST',
    form: {
      datepickerFrom: '01/01/1997',
      datepickerTo: '12/06/2018',
      pageNumber: 1,
      resultPerPage: 100,
      statusFilter: 'deposit',
      isFreeAccount: false
    }
  })
  const items = res.transactionsHistoryItems
  console.log(res)
  console.log(res.transactionsHistoryItems)
  for (let i in items) {
    console.log(items[i].date)
    console.log(items[i].amount)
    console.log(i)
  }
  //  console.log(res)
}

async function authenticate(username, password, dateOfBirth) {
  await request({
    url: loginUrl,
    method: 'POST',
    form: {
      username,
      password,
      dateOfBirth
    }
  })
}

function authenticate2(username, password, dateOfBirth) {
  return signin({
    url: baseUrl,
    formSelector: 'form[class="ui-form loginform"]',
    formData: {
      username,
      password,
      dateOfBirth
    },
    validate: (statusCode, $) => {
      // The login in toscrape.com always works excepted when no password is set
      if ($(`a[href='/logout']`).length === 1) {
        return true
      } else {
        // cozy-konnector-libs has its own logging function which format these logs with colors in
        // standalone and dev mode and as JSON in production mode
        log('error', $('.error').text())
        return false
      }
    }
  })
}

// The goal of this function is to parse a html page wrapped by a cheerio instance
// and return an array of js objects which will be saved to the cozy by saveBills (https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#savebills)
function parseDocuments($) {
  // you can find documentation about the scrape function here :
  // https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#scrape
  const docs = scrape(
    $,
    {
      title: {
        sel: 'h3 a',
        attr: 'title'
      },
      amount: {
        sel: '.price_color',
        parse: normalizePrice
      },
      fileurl: {
        sel: 'img',
        attr: 'src',
        parse: src => `${baseUrl}/${src}`
      },
      filename: {
        sel: 'h3 a',
        attr: 'title',
        parse: title => `${title}.jpg`
      }
    },
    'article'
  )
  return docs.map(doc => ({
    ...doc,
    // the saveBills function needs a date field
    // even if it is a little artificial here (these are not real bills)
    date: new Date(),
    currency: '€',
    vendor: 'template',
    metadata: {
      // it can be interesting that we add the date of import. This is not mandatory but may be
      // usefull for debugging or data migration
      importDate: new Date(),
      // document version, usefull for migration after change of document structure
      version: 1
    }
  }))
}

// convert a price string to a float
function normalizePrice(price) {
  return parseFloat(price.replace('£', '').trim())
}
