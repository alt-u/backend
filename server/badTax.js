const config = require('./config');
const axios = require('axios');

const persistence = require('./sandboxTokenPersistence');
const Starling = require('starling-developer-sdk');
const debug = require('debug')('app:badTax');


const SECRET = '1c59d58c-0f64-4e2b-af75-486411c423c1';
const CHARITY_ACCOUNT = '8c633bb2-40ea-46d2-bef1-01bf9903b47c';


class BadCLient {
    constructor() {
        this.host = config.badHost;
    }

    /**
     * Submit a request, asking money to be transferred.
     *
     * @param {Number} amount
     */
    thing(amount, description, token) {
        const url = `${this.host}/api/badthing/`;

        debug(`Access token: ${token}`)

        const promise = axios.post(url,
            {
                value: amount,
                description
            },
            {
                headers: {
                    'Authorization': token,
                }
            }
        );

        promise.then(
            response => {
                debug(`Response received from bad. Status: ${response.status}`);
            },
            res => {
                debug(res);
                debug(`something bad happened. Token used: ${token}`);
            }
        );

        return promise;
    }
}

/**
 * Fetch metchant location inforamtion.
 *
 * @param {Number} locationId
 */
const getMerchantLocation = (token, merchantId, locationId) => {
    debug(`Fetching client location information for: ${locationId}`)
    if (!locationId) {
        debug('No such location ID supplied');
        return Promise.reject();
    }
    debug(`${config.sandboxApi}api/v1/merchants/${merchantId}/locations/${locationId}`)
    const promise = axios.get(
        `${config.sandboxApi}api/v1/merchants/${merchantId}/locations/${locationId}`,
        {
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${token}`
            }
        }
    );
    promise.then(
        (response) => {
            if (response.status !== 200) {
                return Promise.reject(response);
            }
            return response;
        },
        (response) => {
            debug('Unable to fetch client information');
            debug(response);
        }
    );
    return promise;
}


const validateWebhook = (req, secret) => {
    // TODO: implement this. lulz.
    return true;
}

const shouldApplyTax = (req, starlingClient, token) => {
    let resolvePromise;
    const returningPromise = new Promise((resolve) => {
        resolvePromise = resolve;
    });

    if (req.body.content.type !== 'TRANSACTION_CARD') {
        debug('Not taxing, not interested in type.', req.body.content.type)
        resolvePromise(false);
        return returningPromise;
    }

    const validateResponse = (response) => {
        if (response.status == 200) {
            return response.data
        } else {
            resolvePromise(false);
            return Promise.reject(response);
        }
    }

    // Check merchant information.
    const transactionPromise = starlingClient.getTransaction(
        token,
        req.body.content.transactionUid,
        // Apply some hueristics. We only care about card transactions,
        // but at this point we aren't actually told that this is the
        // transaction type.
        // There's also currently a bug in the in the api, the hook
        // responds with the initial transaction UUID but is not
        // available once the transaction has been settled.
        'MASTER_CARD',
    )

    transactionPromise.then(
        validateResponse
    ).then(
        data => {
            debug('detail data')
            debug(data)
            const locationPromise = getMerchantLocation(
                token,
                data.merchantId,
                data.merchantLocationId
            );

            locationPromise.then(
                (response) => {
                    const code = response.data.mastercardMerchantCategoryCode;
                    const BAR_MERCHANT_CODE = 5813;
                    const badCodes = [BAR_MERCHANT_CODE, ];

                    resolvePromise(badCodes.indexOf(code) !== -1);
                },
                () => {
                    // Faild to get data, we don't care.
                    resolvePromise(false);
                }
            )
        },
        (r) => {
            debug('Received a non 200 status code for the transaction request.');
            debug(r);
        }
    )

    return returningPromise;
}


const tax = (amount, badClient) => {
    badClient.thing(amount);
}


export const start = (app) => {
    debug('Starting bad tax app...');

    const starlingClient = new Starling({apiUrl: config.sandboxApi});

    let db;
    debug('Initializing token store...');
    const dbRef = persistence.initialise((readyDb) => {
        db = readyDb;
        debug('badTax token store db ready');

        debug("badTax app started.")
    })

    const badCLient = new BadCLient();

    const getAccessToken = (db) => persistence.getSandboxTokens(db)['access_token'];

    app.post('/api/bad-tax/starling-hook/', (req, res) => {
        debug('Received hook.');

        if (!validateWebhook(req)) {
            debug('Invalid webhook credentials');
            res.status(400).end();
            return;
        }

        const promise = shouldApplyTax(req, starlingClient, getAccessToken(db));

        promise.then(
            (shouldTax) => {
                if (!shouldTax) {
                    return;
                }
                debug('Applying tax...')

                const amount = Math.abs(req.body.content.amount);
                // Apply a 10% tax.
                // TODO: make this configurable.
                const taxAmount = amount * 0.1;
                debug(`Taxing £${taxAmount}`);
                badCLient.thing(
                    taxAmount,
                    req.body.content.forCustomer,
                    getAccessToken(db),
                );
            }
        )

        res.status(200).end();
    });
};
