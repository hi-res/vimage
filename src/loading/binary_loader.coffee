happens = require 'happens'

module.exports = class BinaryLoader

	constructor: -> happens @

	load: ( asset ) ->

		xhr = @req()
		
		unless type
			type = "arraybuffer"
			try
				type = "blob"  if Blob::slice
		
		xhr.open "GET", asset.src, true
		xhr.responseType = type
				
		xhr.onprogress = (e) ->
			# c.log 'event'

		xhr.onerror = () ->
			@emit 'error', xhr.status

		xhr.onreadystatechange = (e) =>
			if xhr.readyState is 4

				asset.data = xhr.response

				@emit 'loaded', asset
				xhr.onreadystatechange = null
				return

		xhr.send null

	req: ->
		return new XMLHttpRequest() if window.XMLHttpRequest
		new ActiveXObject("MSXML2.XMLHTTP.3.0") if window.ActiveXObject