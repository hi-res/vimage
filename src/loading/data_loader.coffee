happens	= require 'happens'
c 		= require '../log'

module.exports = class DataLoader

	constructor: -> happens @

	load: ( asset ) ->

		xhr = @req()

		xhr.open "GET", asset.src, true
		xhr.overrideMimeType("application/json");  
				
		xhr.onprogress = (e) ->
			# c.log 'event'

		xhr.onerror = () ->
			@emit 'error', xhr.status

		xhr.onreadystatechange = (e) =>
			if xhr.readyState is 4

				asset.data = JSON.parse( xhr.response )

				@emit 'loaded', asset
				xhr.onreadystatechange = null
				return

		xhr.send null

	req: ->
		return new XMLHttpRequest() if window.XMLHttpRequest
		new ActiveXObject("MSXML2.XMLHTTP.3.0") if window.ActiveXObject