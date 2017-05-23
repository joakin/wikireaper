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

let firstRun = true;
const deaths = {};

pollWQS();

function pollWQS() {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  yesterday.setUTCHours(0);
  yesterday.setUTCMinutes(0);
  yesterday.setUTCSeconds(0);
  yesterday.setUTCMilliseconds(0);
  const from = yesterday.toISOString();
  const query = `SELECT ?item ?itemLabel ?desc WHERE { ?item wdt:P31 wd:Q5 . ?item wdt:P570 ?died . FILTER (?died >= "${from}"^^xsd:dateTime) . SERVICE wikibase:label { bd:serviceParam wikibase:language "en" } } ORDER BY DESC(?died)`;
  const url = `https://query.wikidata.org/bigdata/namespace/wdq/sparql?query=${encodeURIComponent(query)}&format=json`;
  console.log('Polling', from);
  getJSON(url)
    .then(res => {
      const newDeaths = updateResults(res.results.bindings);

      if (firstRun) {
        firstRun = false;
      } else {
        notifyNewDeaths(newDeaths);
      }

      setTimeout(pollWQS, 30 * 60 * 1000);
    })
    .catch(console.log);
}

function updateResults(bindings) {
  // Remove missing deaths
  // Old death
  Object.keys(deaths).forEach((death, key) => {
    if (!bindings.find(({ item }) => item.value === key)) delete deaths[key];
  });

  // Collect new ones and return them
  return bindings.reduce((newDeaths, b) => {
    // New death
    if (!/^Q\d+$/.test(b.itemLabel.value) && !deaths[b.item.value]) {
      // Cache it
      deaths[b.item.value] = b;
      return newDeaths.concat(b);
    }
    return newDeaths;
  }, []);
}

function notifyNewDeaths(deaths) {
  deaths.reduce((p, b) => {
    const id = b.item.value.split('http://www.wikidata.org/entity/')[1];
    const url = `https://www.wikidata.org/wiki/Special:EntityData/${id}.json`;

    return getJSON(url)
      .then(response => {
        if (response.entities[id]) post(response.entities[id]);
      })
      .catch(e => {
        console.log(id, e.message);
        return true;
      });
  }, Promise.resolve());
}

function getJSON(url) {
  return new Promise((resolve, rej) => {
    https
      .get(url, res => {
        const { statusCode } = res;
        const contentType = res.headers['content-type'];

        let error;
        if (statusCode !== 200) {
          error = new Error(`Request Failed.\n` + `Status Code: ${statusCode}`);
        } else if (!/json/.test(contentType)) {
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

http
  .createServer((req, res) => {
    res.end(JSON.stringify(deaths), null, 2);
  })
  .listen(process.env.PORT || 3001);

const templates = [
  data =>
    `¯\\_(ツ)_/¯ ${getLabel(data)} -${getDescription(data)}- has left us. ${getLink(data)}`,
  data =>
    `Whoops! ${getLabel(data)} -${getDescription(data)}- is dead. ${getLink(data)}`,
  data => 
    `RIP ${getLabel(data)}, ${getDescription(data)}. ${getLink(data)}`,
  data => 
    `${getLabel(data)}, ${getDescription(data)}, has shuffled off this mortal coil. ${getLink(data)}`,
  data => 
    `${getLabel(data)}, ${getDescription(data)}, has passed on, perished, expired. ${getLink(data)}`,
  data => 
    `Bereft of life, ${getLabel(data)}, ${getDescription(data)}, now rests in peace. ${getLink(data)}`,
  data => 
    `${getLabel(data)}, ${getDescription(data)} has kicked the bucket. ${getLink(data)}`,
  data => 
    `Oh dear, ${getLabel(data)}, ${getDescription(data)}, is pushing up daisies. ${getLink(data)}`,
  data => 
    `${getLabel(data)}, ${getDescription(data)}, has joined the choir invisible. ${getLink(data)}`,
  data => 
    `${getLabel(data)}, ${getDescription(data)}, is probably not pining for the fjords. ${getLink(data)}`,
  data => 
    `${getLabel(data)}, ${getDescription(data)}, is dead as a dodo, doorknob, or stump. ${getLink(data)}`,
  data => 
    `The dust has been bitten by ${getLabel(data)}, ${getDescription(data)}. ${getLink(data)}`,
  data => 
    `☠ ${getLabel(data)} ☠ ${getDescription(data)} ☠ ${getLink(data)} ☠`,
  data => 
    `💀 ${getLabel(data)} 💀 ${getDescription(data)} 💀 ${getLink(data)} 💀`,
  data => 
    `Dearly departed, ${getLabel(data)}, ${getDescription(data)}, now defunct. ${getLink(data)}`,
];

function getLabel(item) {
  if (item.labels) {
    return (
      (item.labels['en'] && item.labels['en'].value) ||
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
      (item.descriptions['en'] && item.descriptions['en'].value) ||
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
      (item.sitelinks['enwiki'] && item.sitelinks['enwiki'].url) ||
      (Object.keys(item.sitelinks).length > 0 &&
        item.sitelinks[Object.keys(item.sitelinks)[0]].url) ||
      ''
    );
  }
  return '';
}

function post(item) {
  const tpl = templates[Math.floor(Math.random() * templates.length)];

  const status = tpl(item);
  twitter.post('statuses/update', { status }, function(err, data, response) {
    if (err) {
      console.log(err);
    }
    console.log(status);
  });
}
