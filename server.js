const got = require("got");
const express = require("express");
const app = express();
const fs = require("fs");
if (fs.existsSync(".env")) process.loadEnvFile();

const mainChannelURL = "https://www.youtube.com/TheGreatBerate/live";
const getTokenURL = `https://id.twitch.tv/oauth2/token?client_id=${process.env.CLIENT_ID}&client_secret=${process.env.CLIENT_SECRET}&grant_type=client_credentials`;
const puppyChannelURL = "https://api.twitch.tv/helix/streams?user_id=2231726";
const spreadsheetURL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQYPWJ_vByOtSB_hmV0nHj348nVrKIpwbijjRMEXvxltE0MHeJ5jTg08PsT-8NPfJo7XLc_UJylpGIe/pub?gid=0&single=true&output=tsv";
const videosURL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQYPWJ_vByOtSB_hmV0nHj348nVrKIpwbijjRMEXvxltE0MHeJ5jTg08PsT-8NPfJo7XLc_UJylpGIe/pub?gid=984650252&single=true&output=tsv";

const twitchOptions = {
  headers: {
    "Client-Id": process.env.CLIENT_ID
  }
};

const get = (url, options = {}) =>
  new Promise((resolve, reject) => {
    got(url, options)
      .then(response => resolve(response.body))
      .catch(error => reject(error));
  });

function pickItem(array) {
  return array[Math.floor(Math.random() * array.length)];
}

async function getAppAccessToken() {
  if (fs.existsSync("access_token")) {
    let token = fs.readFileSync("access_token");
    return token;
  }

  const token = JSON.parse(await get(getTokenURL, { method: "POST" }))[
    "access_token"
  ];
  fs.writeFileSync("access_token", token);
  return token;
}

function increaseStat(name) {
  var date = new Date();
  var key = `${date.getFullYear()}-${date.getMonth() + 1}`;

  var json = JSON.parse(fs.readFileSync("stats.json"));
  if (!json.hasOwnProperty(key)) json[key] = { visit: 0, video: 0 };

  json[key][name]++;

  fs.writeFileSync("stats.json", JSON.stringify(json, null, 2));
}

const videos = {};
let lastVideoFetch;
function getVideos() {
  if (new Date() - lastVideoFetch >= 1000 * 60 * 60 * 24) {
    videos = {};
  }

  if (Object.entries(videos).length > 0) {
    return new Promise(resolve => resolve(videos));
  }

  lastVideoFetch = new Date();
  return get(videosURL)
    .then(body => {
      for (const rowText of body.split("\r\n").splice(1)) {
        const row = rowText.split("\t");
        const group = row[1] == "" ? row[0] : row[1];

        if (!videos.hasOwnProperty(group)) videos[group] = [];

        videos[group].push(row[0]);
      }

      return videos;
    })
    .catch(error => {
      console.log(error);
      return null;
    });
}

// https://stackoverflow.com/a/46499108/8213163
app.use((req, res, next) => {
  res.append("Access-Control-Allow-Origin", ["*"]);
  res.append("Access-Control-Allow-Methods", "GET");
  res.append("Access-Control-Allow-Headers", "Content-Type");
  next();
});

async function getTwitchStatus(status) {
  const token = await getAppAccessToken();
  twitchOptions.headers["Authorization"] = "Bearer " + token;

  try {
    const body = await get(puppyChannelURL, twitchOptions);
    status.puppy = JSON.parse(body).data.length != 0;
  } catch (error) {
    // If our token expired, get a new one.
    if (error.statusCode == 401) {
      fs.rmSync("access_token");
      return await getTwitchStatus(status);
    }

    console.log(error, error.response);
  }
}

app.get("/status", (request, response) => {
  const status = {
    main: null,
    puppy: null
  };

  Promise.all([
    get(mainChannelURL).then(body => {
      status.main = body.includes(
        `\"playabilityStatus\":{\"status\":\"OK\",\"playableInEmbed\"`
      );
    }),
    getTwitchStatus(status)
  ])
    .then(() => response.json(status))
    .catch(error => {
      console.error(error);
      response.status(500).end();
    });
});

app.get("/schedule", (request, response) => {
  const schedule = [];

  get(spreadsheetURL)
    .then(body => {
      for (const rowText of body.split("\r\n").splice(1)) {
        const row = rowText.split("\t");
        schedule.push(row);
      }
    })
    .then(() => {
      increaseStat("visit");
      response.json(schedule);
    })
    .catch(error => response.status(500).end());
});

app.get("/video", (request, response) => {
  getVideos()
    .then(allVideos => {
      const group = pickItem(Object.keys(allVideos));
      increaseStat("video");
      response.redirect(pickItem(allVideos[group]));
    })
    .catch(() => response.status(500).end());
});

app.get("/stats", (request, response) => {
  if (request.query.token != process.env.TOKEN)
    return response.status(401).end();

  var json = JSON.parse(fs.readFileSync("stats.json"));
  var html =
    "<style>table { border-collapse: collapse; } th, td { padding: .2em; border: 1px solid black; }</style> <table><tr><th>Date<th>Visits<th>Videos";
  var total = { visit: 0, video: 0 };
  response.send(
    `${html}${Object.entries(json)
      .map(pair => {
        total.visit += pair[1].visit;
        total.video += pair[1].video;
        return `<tr><td>${pair[0]}<td>${pair[1].visit}<td>${pair[1].video}`;
      })
      .join("")}<tr><td>Total<td>${total.visit}<td>${total.video}`
  );
});

const listener = app.listen(process.env.PORT, () => {
  console.log("Your app is listening on port " + listener.address().port);
});
