const EventSource = require('eventsource');
const url = 'https://stream.wikimedia.org/v2/stream/recentchange';
const http = require('http');
const https = require('https');
const Twit = require('twit');

const config = {
  consumer_key: process.env.CONSUMERKEY,
  consumer_secret: process.env.CONSUMERSECRET,
  access_token: process.env.ACCESSTOKEN,
  access_token_secret: process.env.ACCESSTOKENSECRET
};

const twitter = new Twit(config);

let lastEventData = null;
let lastEvent = null;

function initEventSource() {
  console.log(`Connecting to EventStreams at ${url}`);
  const eventSource = new EventSource(url, {
    headers: {
      'Last-Event-ID': JSON.stringify([
        { topic: 'codfw.mediawiki.recentchange', partition: 0, offset: -1 },
        {
          topic: 'eqiad.mediawiki.recentchange',
          partition: 0,
          // offset: 164621801 // 164539804 // 163892993 //177141947 - 10000
          offset: 177186114 // 177141947 - 100000 // 164621801 // 164539804 // 163892993 //177141947 - 10000
        }
      ])
    }
  });

  eventSource.onopen = function(event) {
    console.log('--- Opened connection.');
  };

  eventSource.onerror = function(event) {
    console.error('--- Encountered error', event);
  };

  eventSource.onmessage = function(event) {
    const data = JSON.parse(event.data);
    if (data.server_name === 'www.wikidata.org') {
      processEvent(data)
        .then(data => {
          deathFound(event, data);
          lastEventData = data;
          lastEvent = event;
        })
        .catch(e => {
          if (e.message !== 'No match' && e.message != 'Not today')
            console.log(e.message);
        });
    }
  };
}

http
  .createServer((req, res) => {
    if (!lastEventData) return res.end('Nothin');
    res.end(JSON.stringify([lastEvent, lastEventData]), null, 2);
  })
  .listen(process.env.PORT || 3001);

function getDateFromComment(comment) {
  return comment.match(/P570\]\]\: (\d\d?) ([A-Za-z]+) (\d\d\d\d)$/);
}

function processEvent(data) {
  return new Promise((res, rej) => {
    const match = getDateFromComment(data.comment);
    if (!match) throw new Error('No match');
    const [_, dayStr, monthStr, yearStr] = match;
    const [day, month, year] = [
      parseFloat(dayStr),
      monthToNumber(monthStr),
      parseFloat(yearStr)
    ];
    const now = new Date();
    if (
      now.getFullYear() === year &&
      now.getMonth() === month &&
      now.getDate() - 3 < day &&
      now.getDate() >= day
    ) {
      res(data);
    }
    rej(new Error('Not today'));
  });
}

const months = {
  January: 0,
  February: 1,
  March: 2,
  April: 3,
  May: 4,
  June: 5,
  July: 6,
  August: 7,
  September: 8,
  October: 9,
  November: 10,
  December: 11
};
function monthToNumber(str) {
  if (months[str]) return months[str];

  throw new Error('invalid month');
}

function deathFound(event, data) {
  const title = data.title;
  getItem(title)
    .then(response => {
      if (response.entities[title]) post(event, data, response.entities[title]);
    })
    .catch(e => console.log(title, e.message));
}

function getItem(title) {
  return new Promise((resolve, rej) => {
    const url = `https://www.wikidata.org/wiki/Special:EntityData/${title}.json`;
    https
      .get(url, res => {
        const { statusCode } = res;
        const contentType = res.headers['content-type'];

        let error;
        if (statusCode !== 200) {
          error = new Error(`Request Failed.\n` + `Status Code: ${statusCode}`);
        } else if (!/^application\/json/.test(contentType)) {
          error = new Error(
            `Invalid content-type.\n` +
              `Expected application/json but received ${contentType}`
          );
        }
        if (error) {
          rej(error);
          res.resume();
          return;
        }

        res.setEncoding('utf8');
        let rawData = '';
        res.on('data', chunk => {
          rawData += chunk;
        });
        res.on('end', () => {
          try {
            const parsedData = JSON.parse(rawData);
            resolve(parsedData);
          } catch (e) {
            rej(e);
          }
        });
      })
      .on('error', e => {
        rej(e);
      });
  });
}

const templates = [
  (data, eventData) =>
    `Whoops! ¯\\_(ツ)_/¯ ${getLabel(data)} -${getDescription(data)}- is dead. ${getLink(data)} ${getDate(eventData)}`,
  (data, eventData) =>
    `RIP ${getLabel(data)}, ${getDescription(data)}. ${getLink(data)} ${getDate(eventData)}`
];

function getDate(data) {
  const match = getDateFromComment(data.comment);
  if (!match) return '';
  return `${match[1]} ${match[2]}, ${match[3]}`;
}

function getLabel(item) {
  if (item.labels) {
    return (
      item.labels['en'].value ||
      (Object.keys(item.labels).length > 0 &&
        item.labels[Object.keys(item.labels)[0]].value) ||
      'Unknown'
    );
  }
  return 'Unknown';
}

function getDescription(item) {
  if (item.descriptions) {
    return (
      item.descriptions['en'].value ||
      (Object.keys(item.descriptions).length > 0 &&
        item.descriptions[Object.keys(item.descriptions)[0]].value) ||
      ''
    );
  }
  return '';
}

function getLink(item) {
  if (item.sitelinks) {
    return (
      item.sitelinks['enwiki'].url ||
      (Object.keys(item.sitelinks).length > 0 &&
        item.sitelinks[Object.keys(item.sitelinks)[0]].url) ||
      ''
    );
  }
  return '';
}

function post(event, data, item) {
  const tpl = templates[Math.floor(Math.random() * templates.length)];

  const status = tpl(item, data);
  twitter.post('statuses/update', { status }, function(err, data, response) {
    if (err) {
      console.log(err);
    }
    console.log(status);
  });
}

initEventSource();
