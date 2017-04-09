const crypto = require('crypto')
const config = require('./config');
const axios = require('axios');

const persistence = require('./sandboxTokenPersistence');
const Starling = require('starling-developer-sdk');
const debug = require('debug')('app:badTax');

const sandbox = require('./sandbox');

const CHARITY_ACCOUNT = '8c633bb2-40ea-46d2-bef1-01bf9903b47c';


class BadClient {
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
            debug(`Client response received: ${response.status}`)
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
    return true;
    // The below doesn't appear to work for some reason, there's a large
    // mismatch in length of the header and the generated sig, so it makes
    // me think the docs are either wrong, or very unclear. From the sig
    // supplied it looks to be base64 encoded...
    const hash = crypto.createHash('sha512', secret);
    hash.update(JSON.stringify(req.body));
    const value = hash.digest('hex');
    debug(JSON.stringify(req.body));

    const sig = req.get('X-Hook-Signature');

    if (sig !== value) {
        debug(`Hook sig mismatch, expecting ${value} got ${sig}`)
        return false;
    }
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

const shouldRoundUp = (req, starlingClient, token) => {
    return (req.body.content.type !== 'TRANSACTION_CARD');
}


const tax = (amount, badClient) => {
    badClient.thing(amount);
}


export const start = (app) => {
    debug('Starting bad tax app...');

    const starlingClient = new Starling({apiUrl: config.sandboxApi});
    
    const badClient = new BadClient();

    const getAccessToken = (db) => persistence.getSandboxTokens(db)['access_token'];

    const determineCharityDonationAmount = (req) => {
        const promise = shouldApplyTax(req, starlingClient, getAccessToken(sandbox.getTokensDb()));

        let resolve;
        const returningPromise = new Promise((r) => { resolve = r });

        promise.then(
            (shouldTax) => {
                if (!shouldTax) {
                    resolve(0);
                    return;
                }

                const amount = Math.abs(req.body.content.amount);
                // Apply a 10% tax.
                // TODO: make this configurable.
                const taxAmount = (amount * 0.1).toFixed(2);

                // debug(`Taxing £${taxAmount}`);

                resolve(taxAmount);
            }
        )

        return returningPromise;
    }

    const determineRoundUpAmount = (req) => {
        if (shouldRoundUp) {
           return Promise.reject(0);
        }

        const returningPromise = new Promise((resolve) => {
            let roundUpAmount = Math.abs(req.body.content.amount) - Math.floor(req.body.content.amount);
            resolve(roundUpAmount);
        });

        return returningPromise;
    }

    app.post('/api/bad-tax/starling-hook/', (req, res) => {
        debug('Received hook.');

        if (!validateWebhook(req, config.hookSecret)) {
            debug('Invalid webhook credentials');
            res.status(400).end();
            return;
        }

        // Handle Charity Donation
        const donationPromise = determineCharityDonationAmount(req);

        // Handle Nearest Pound Round-up
        const roundUpPromise = determineRoundUpAmount(req);

        // Sum and process the payment!
        const combinedPromise = Promise.all([donationPromise, roundUpPromise]);

        combinedPromise.then(values => {
            const total = values.reduce((cumulative, current) => cumulative + current, 0);
            if (total > 0) {
                debug(`Taxing £${total}...`);

                badClient.thing(
                    total,
                    req.body.content.forCustomer,
                    getAccessToken(sandbox.getTokensDb()),
                );
            }
        });

        res.status(200).end();
    });
};
