// npm init
// npm i
// npm install dotenv mongodb express body-parser ejs axios

const express = require('express');
const { MongoClient, ServerApiVersion } = require('mongodb');
const path = require('path');
const readline = require('readline');
const axios = require('axios');
const { INSPECT_MAX_BYTES } = require('buffer');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.set('views', path.join(__dirname, 'templates'));
app.set('view engine', 'ejs');

const client = new MongoClient(process.env.MONGO_CONNECTION_STRING, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverApi: ServerApiVersion.v1
});

const database = { db: process.env.MONGO_DB_NAME, collection: process.env.MONGO_COLLECTION };

//const args = process.argv.slice(2);
//const PORT = args.length === 1 ? parseInt(args[0], 10) : process.env.PORT;
const port = process.env.PORT || 7000

/* if (args.length !== 1) {
    console.log('Usage summerCampServer.js Port_Number');
    process.exit(1);
} */

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});


// Main page route
app.get('/', (req, res) => {
    res.render('index');
});

app.get('/StockOptions', (req, res) => {
    res.render('StockOptions');
});

app.post('/OptionsDisplay', async (req, res) => {
    try {
        await client.connect();
        const stockExchange = req.body.stockExchange;
        const options = {
            method: 'GET',
            url: `https://yahoo-finance127.p.rapidapi.com/search/${stockExchange}`,
            headers: {
                'X-RapidAPI-Key': '843902855dmsh2fe2b3db7250bb8p1ced77jsn6e80e5a8a39c',
                'X-RapidAPI-Host': 'yahoo-finance127.p.rapidapi.com'
            }
        };

        const response = await axios.request(options);
        const stockData = response.data;

        console.log('API Response:', stockData);

        res.render('OptionsDisplay', { stockData });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        await client.close();
    }
});

app.get('/yourStocks', async (req, res) => {
    res.render('yourStocks');
});

app.post('/DisplayYourStocks', async (req, res) => {
    let filter = {
        userName: req.body.userName,
        password: req.body.password
    };
    try {
        await client.connect();
        const data = await client.db(database.db)
            .collection(database.collection)
            .find(filter).toArray();

        // Fetch the stock prices from the Yahoo Finance API
        const stockPrices = await Promise.all(
            data.map(async (item) => {
                const options = {
                    method: 'GET',
                    url: `https://yahoo-finance127.p.rapidapi.com/price/${item.stock}`,
                    headers: {
                        'X-RapidAPI-Key': '843902855dmsh2fe2b3db7250bb8p1ced77jsn6e80e5a8a39c',
                        'X-RapidAPI-Host': 'yahoo-finance127.p.rapidapi.com'
                    }
                };
                const response = await axios.request(options);
                return {
                    stock: item.stock,
                    buyPrice: item.stockPrice,
                    sellPrice: response.data.regularMarketPrice.raw,
                    regularMarketTime: {
                        raw: response.data.regularMarketTime.raw,
                        date: (new Date((response.data.regularMarketTime.raw) * 1000)).toLocaleDateString(),
                        fmt: response.data.regularMarketTime.fmt
                    },
                    timeBought: {
                        raw: item.rawTime,
                        date: item.date,
                        fmt: item.fmtTime
                    },
                    share: item.share
                };
            })
        );

        // Calculate Profit/Loss and group the data by stock name and time
        const stockData = stockPrices.reduce((acc, cur) => {
            const key = `${cur.stock}_${cur.timeBought.raw}`;
            if (!acc[key]) {
                acc[key] = {
                    stock: cur.stock,
                    buyPrice: cur.buyPrice,
                    sellPrice: cur.sellPrice,
                    regularMarketTime: cur.regularMarketTime,
                    timeBought: cur.timeBought,
                    totalShares: 0,
                    totalValue: 0,
                    profitLoss: 0
                };
            }
            acc[key].totalShares += cur.share;
            acc[key].totalValue = acc[key].sellPrice * acc[key].totalShares;
            acc[key].profitLoss = (acc[key].sellPrice - acc[key].buyPrice) * acc[key].totalShares;
            return acc;
        }, {});

        res.render('DisplayYourStocks', { stockData: Object.values(stockData) });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        await client.close();
    }
});

app.get('/StockTrader', (req, res) => {
    res.render('StockTrader');
});

app.get('/RemoveStock', (req, res) => {
    res.render('RemoveStock');
});

app.post('/submitData', async (req, res) => {
    const applicationData = {
        userName: req.body.userName,
        password: req.body.password,
        stock: req.body.stock,
        share: parseFloat(req.body.share),
        note: req.body.note
    };

    try {
        await client.connect();
        const options = {
            method: 'GET',
            url: `https://yahoo-finance127.p.rapidapi.com/price/${applicationData.stock}`,
            headers: {
                'X-RapidAPI-Key': '843902855dmsh2fe2b3db7250bb8p1ced77jsn6e80e5a8a39c',
                'X-RapidAPI-Host': 'yahoo-finance127.p.rapidapi.com'
            }
        };

        const response = await axios.request(options);
        const stockData = response.data;

        // Calculate the total value of the shares
        const totalValue = stockData.regularMarketPrice.raw * applicationData.share;

        // Get time at which stock was bought (raw)
        const rawTime = stockData.regularMarketTime.raw;

        // Get time at which stock was bought (formatted)
        const fmtTime = stockData.regularMarketTime.fmt;

        // Get the date using rawTime
        const dateObj = new Date(rawTime * 1000);
        const date = dateObj.toLocaleDateString();

        // Save the application data and stock price to MongoDB
        await client.db(database.db).collection(database.collection).insertOne({
            ...applicationData,
            stockPrice: stockData.regularMarketPrice.raw,
            totalValue,
            rawTime,
            fmtTime,
            date
        });

        res.render('dataScreen', {
            data: {
                ...applicationData,
                stockPrice: stockData.regularMarketPrice.raw,
                totalValue,
                rawTime,
                date,
                fmtTime
            }
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        await client.close();
    }
});

app.post('/RemoveStock', async (req, res) => {
    let filter = {
        userName: req.body.userName,
        password: req.body.password,
        stock: req.body.stock
    };

    try {
        await client.connect();
        let result = await client.db(process.env.MONGO_DB_NAME)
            .collection(process.env.MONGO_COLLECTION)
            .deleteOne(filter);

        if (result.deletedCount === 1) {
            res.render('index');
        } else {
            res.status(404).send('No matching document found to delete');
        }
    } catch (error) {
        console.error('Error removing stock:', error);
        res.status(999).send('Error removing stock');
    } finally {
        await client.close();
    }
});

app.listen(port, () => {
    console.log(`Web Server started and running at http://localhost:${port}`);
    rl.setPrompt('Stop to shutdown the server: ');
    rl.prompt();

    rl.on('line', (line) => {
        switch (line.trim()) {
            case 'stop':
                console.log('Shutting down the server');
                process.exit(0);
                break;
            default:
                console.log(`Invalid command: ${line.trim()}`);
        }
        rl.prompt();
    }).on('close', () => {
        console.log('Shutting down the server');
        process.exit(0);
    });
});
