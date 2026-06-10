---
title: 'Computational Chemistry from Scratch'
date: 2025-02-24
tags: ['Computational Chemistry', 'Physics', 'Chemistry']
summary: 'Building up the approximations behind computational chemistry with no prerequisites beyond precalculus, high-school calculus, and curiosity. Part one of a series.'
scene: 'density'
---

So you want to learn computational chemistry but haven't taken quantum mechanics,
chemistry, physical chemistry, and numerical algorithms? No problem. In this series we'll
build up the approximations used in computational chemistry with no prerequisites other
than precalculus, high-school calculus, and an enthusiastic reader.

## Motivation

Chemistry is an expensive and dangerous field. Doubtless you've heard stories of chemists
blowing up their labs, inhaling toxic fumes, or needing very expensive equipment to run
experiments. A more convenient way to do chemistry is to sit at home and *simulate*
experiments with our wonderful computers.

Our goal today is to simulate the behavior of atoms with programming.

How can we do that? What even *is* an atom?

## Starting

Many of these questions are better reserved for an expert in quantum mechanics — but here
I'll present a few key assumptions and build our approximations up from there.

1. **We can represent the full state of an atom with a symbol, $\psi$.** By "state of an
   atom" I mean this: $\psi$ will tell us *everything* we could ever want to know about
   the atom.
2. **Applying functions[^1] to $\psi$ gives us information about the atom.** We'll soon
   define operations on $\psi$ that extract physical quantities.
3. **Every atom has an intrinsic "energy."** You can think of this as how much it can move
   now plus how much movement it has stored up for the future. The energy of a car, for
   instance, is related to how fast it's moving *and* how much it will be able to move
   later.

Now for a little history. At the turn of the 20th century, physicists like Niels Bohr,
Albert Einstein, and Max Planck discovered something striking about the atoms we've been
describing: **every atom can only take on certain energies.** We can't have a continuous
range of energies for an atom — the allowed energies are *discrete*. It's a bit like how
you can have one plate or two plates, but half a plate doesn't quite make sense.

This single fact — quantization — is where everything interesting begins. In the next
part, we'll turn these assumptions into something we can actually compute.

[^1]: Technically, we apply *operators* to $\psi$ — functions that take in a function and
return another function (often scaled by a number we care about).

*This is part one of an evolving series — more soon.*
