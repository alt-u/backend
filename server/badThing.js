const config = require('./config');
const Starling = require('starling-developer-sdk');
const starlingApiWrapper = require('./starling-api-wrapper');
const request = require("request")
const debug = require('debug')('app:badThing');

const start = (app) => {
  
  app.post('/api/badthing', (req, res) => {

		var value = req.body.value || req.body['value'] || "",
			desc = req.body.description || req.body['description'] || "",
			auth = req.headers.Authorization || req.headers['Authorization'] || req.headers.authorization || ""

		console.log(`Auth Header: ${auth}`);
		// console.log(`Body: ${req.body}`);
		debug(req.body);
		console.log(`Value: ${value}`);
		console.log(`Description: ${desc}`);
		
		if ( auth.length === 0 ) {
			
			res.status(401).send({message: "Not authed"})
			return
			
		}
		
		if ( value.length === 0 || desc.length === 0 ) {

			res.status(400).send({message: "Missing value or description"})
			return

		}
		
		request("https://api-sandbox.starlingbank.com/api/v1/accounts/balance",{
			method: "GET",
			headers: {
				"Authorization": `Bearer ${auth}`
			}
		},(err, response) => {
			
			var body = JSON.parse(response.body)

			if ( body.availableToSpend < value ) {

				res.status(402).send({ message: "Insufficient Funds" })

			} else {

				request("https://api-sandbox.starlingbank.com/api/v1/contacts",{
					method: "POST",
					json: {
						name: "Charity",
						accountNumber: "36813694",
						sortCode: "608371"
					},
					headers: {
						"Authorization": `Bearer ${auth}`
					}
				},(err, response) => {

					if ( response.statusCode === 202 ) {

						let charity = response.headers.location.split('/')
						let charityId = charity[charity.length-1]

						request("https://api-sandbox.starlingbank.com/api/v1/payments/local",{
							method: "POST",
							json: {
								destinationAccountUid: charityId,
								payment: {
									amount: value,
									currency: "GBP"
								},
								reference: "Donation"
							},
							headers: {
								"Authorization": `Bearer ${auth}`
							}
						},(err, response) => {
							
							if ( response.statusCode === 202 ) {

								res.status(202).send({success: true})

							} else {

								res.status(500).send({message: "yeah something went wrong (starling not us)...", actual: response.body})

							}

						})

					} else {

						res.status(500).send({message: "Can't find charity account"})

					}

				})

			}

		})

  });

};
module.exports = { start };
