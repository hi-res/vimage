module.exports =
	
	###
	https://gist.github.com/svlasov-gists/2383751
	###
	merge: (target, source) ->

		# Merges two (or more) objects,
		# giving the last one precedence

		target = {}  if typeof target isnt "object"

		for property of source
			if source.hasOwnProperty(property)
				sourceProperty = source[property]
				if typeof sourceProperty is "object"
					target[property] = @merge(target[property], sourceProperty)
					continue
				target[property] = sourceProperty
		a = 2
		l = arguments.length

		while a < l
			merge target, arguments[a]
			a++

		target