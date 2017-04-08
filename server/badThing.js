const config = require('./config');
const Starling = require('starling-developer-sdk');
const starlingApiWrapper = require('./starling-api-wrapper');
const request = require("request")

const start = (app) => {
  
  app.post('/api/badthing', (req, res) => {

		var value = req.body.value || "",
			desc = req.body.description || "",
			auth = req.headers.authorization || ""
		
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

				res.status(402).send({message: "Insuficcient Funds"})

			} else {

				request("https://api-sandbox.starlingbank.com/api/v1/payments/local",{
					method: "POST",
					json: {
						destinationAccountUid: "dbea64d9-8900-41b8-aaee-6e10b5358b67",
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
					console.log(response.body)
					if ( response.statusCode === 202 ) {

						res.status(202).send({success: true})

					} else {

						res.status(500).send({message: "yeah something went wrong (starling not us)..."})

					}

				})

			}

		})

  });

};
module.exports = { start };
