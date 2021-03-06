function foreach(t, f) {
    for(var i=0; i < t.length; ++i) f(t[i], i);
}

var sign = function(a, b) {
	let n = a>>1, sum = 0;
	while(n != 0) {
		sum += grade(n&b)
		n >>= 1;
	}
    return sum&1 ? -1 : 1;
}
var grade = function(b) {
	let n = 0;
	while(b != 0) {
		if( (b&1)==1 ) n += 1;
		b >>= 1;
	}
	return n;
}

fetch("/versor/wasm/sign.wasm")
    .then(
        res => {
            if (res.ok) return res.arrayBuffer();
            throw new Error('Unable to fetch WASM');
        }
    )
    .then(bytes => WebAssembly.compile(bytes))
    .then(module => WebAssembly.instantiate(module))
    .then(
        instance => {
            sign = instance.exports._Z4signmm;
            grade = instance.exports._Z5gradem;
            console.log("WASM functions imported");
        }
    )
;

/*	Data structure representing a blade (coordinate + scale factor)
    b - bitwise representation of coordinate
    wt - scale factor
*/
function blade(b, wt) { return { id:b, w:wt }; }

function type(key, bases, name) {
    return { key:key, bases:bases, name:name, generated:false, dual:false };
}

function classname(name) { return "_"+name; }

/*	Calculate the product between two coordinates
    a - bitwise representation of coordinate
    b - bitwise representation of coordinate
    returns a blade
*/
function product(a, b) {
    var res = a^b;
    var s = sign(a, b);
    return blade(res, s);
}

/*	Calculate the outer product between two coordinates
    a - bitwise representation of coordinate
    b - bitwise representation of coordinate
    returns a blade
*/
function outer(a, b) {
    if((a&b)!=0) return blade(0, 0);
    else return product(a, b);
}

function involute(x) {
    let g = grade(x);
    let n = Math.pow(-1, g);
    return blade(x, n);
}

function reverse(x) {
    let g = grade(x);
    let n = Math.pow(-1, (g*(g-1)/2.0));
    return blade(x, n);
}

function conjugate(x) {
    let g = grade(x);
    let n = Math.pow(-1, (g*(g+1)/2.0));
    return blade(x, n);
}


/*	Calculate the name of a coordinate
    b - bitwise representation of coordinate
*/
function basisString(b) {
    let n=0;
    let res = "";
    while(b != 0) {
        n += 1;
        if((b&1) == 1) res += n;
        b >>= 1;
    }
    if(n > 0) return "e"+res;
    else return "s";
}

function basisBit(name) {
    if(name == "s") return 0;

    let x = 0;
    let lastn = parseInt(name.substr(name.length-1));
    for(let i=lastn; i > 0; --i) {
        x <<= 1;
        if(name.search(i) >= 0) x += 1;
    }
    return x;
}

function basisBits(bases) {
    let ids = [];
    for(let i=0; i < bases.length; ++i) {
        ids[i] = basisBit(bases[i]);
    }
    return ids;
}

function basisNames(ty) {
    ty.sort(function(a, b) {
        return (a<b) ? -1 : 1;
    });

    let coords = [];
    for(let i=0; i < ty.length; ++i) {
        coords[i] = basisString(ty[i])
    }
    return coords;
}


function keyCheck(k1, k2) {
    if(k1.length != k2.length) return false;
    for(let i=0; i < k1.length; ++i) {
        if(k1[i] != k2[i]) return false;
    }
    return true;
}

function order(c) {
    let tblades = [];
    for(let i in c) {
        tblades[tblades.length] = parseInt(i);
    }
    tblades.sort(function(a, b) {
        return (a<b) ? -1 : 1;
    });
    return {
        blades: tblades,
        inst: c
    };
}

function compress(x) {
    let tally = {};

    // collect like terms
    for(let i=0; i < x.length; ++i) {
        let iv = x[i];
        if(tally[iv.id]) {
            tally[iv.id].w += iv.w;
        }
        else {
            tally[iv.id] = blade(iv.id, iv.w);
        }
    }

    let res = [];
    for(let id in tally) {
        let iv = tally[id];
        if(iv.w != 0) {
            res.push(iv);
        }
    }
    return res;
}

function printLines(text, from, to) {
    let lines = text.match(/^.*((\r\n|\n|\r)|$)/gm);
    from = from || 0;
    to = to || lines.length;

    for(let i=from; i < to; ++i) {
        console.log((i+1)+"\t"+lines[i].substr(0, lines[i].length-1));
    }
}

class Space {
    constructor(props = {}) {
        props.metric = props.metric || [1, 1, 1];
        props.types = props.types || [];
        props.binops = props.binops || [];


        this.metric = props.metric;
        this.basis = this.buildBasis();
        this.types = this.buildTypes();
        return;
        if(props.conformal) {
            this.values = this.buildConformalValues();
            this.products = this.buildConformal();
        }
        else {
            this.products = this.buildEuclidean();
        }
        this.subspaces = this.buildSubspaces();
        this.registerSubspaces();
        this.createTypes(props.types);	

        this.api = this.generate(props);
        for(var name in this.api.constructors) {
            this[name] = this.api.constructors[name];
        }
        this.initialized = true;
    }
    generate(props) {
        let binopCode = this.generateBinops(props.binops);
        let typeCode = this.generateRegisteredTypes();
        let typeCodeAliases = {};
        for(let name in typeCode) {
            let ty = this.types[name];
            if(ty.alias && name == ty.alias) {
                typeCodeAliases[name] = typeCode[name];
            }
        }
        let functionBody = ["let api = { classes:{}, constructors:{} };"];
        for(var name in typeCode) {
            if(!typeCodeAliases[name]) {
                var code = typeCode[name];
                functionBody.push([
                    code,
                    `api.constructors.${name} = ${name};`,
                    `api.classes.${name} = classname(${name});`,
                ].join("\n")
                );
                if(this.types[name].alias) {
                    var aliasName = this.types[name].alias;
                    var aliasCode = typeCodeAliases[aliasName];
                    functionBody.push([
                        aliasCode,
                        `api.constructors.${aliasName} = ${aliasName};`,
                        `api.classes.${aliasName} = classname(${aliasName});`
                    ].join("\n")
                    );
                }
            }
        }

        functionBody = functionBody.concat(binopCode);
        functionBody.push("return api;");
        return new Function("space", functionBody.join("\n\n"))(this);
    }
    metricProduct(a, b) {
        let tmp = product(a, b);
        let bs = a&b;
        let i = 1;
        while(bs != 0) {
            if((bs&1) == 1) tmp.w *= this.metric[i-1];
            bs >>= 1;
            ++i;
        }
        return tmp;
    }
    metricInner(a, b) {
        let tmp = this.metricProduct(a, b);
        let g = grade(b) - grade(a);
        return grade(a) > grade(b) || grade(tmp.id) != g
            ? blade(0, 0) : tmp;
    }
    key(b) {
        let nkeys = Math.ceil(this.basis.length/32)
        let key = [];
        for(let i=0; i < nkeys; ++i) key[i] = 0;

        if(b != undefined) {
            let k = Math.ceil((b+1)/32);
            let shft = (b+1) - 32*(k-1);
            key[k-1] = 1<<shft-1;
        }

        return key;
    }
    basesKey(bases) {
        let key = this.key();
        for(let i=0; i < bases.length; ++i) {
            let b = bases[i];
            let ty = this.types[basisString(b)];
            for(let k=0; k < ty.key.length; ++k) {
                key[k] = key[k] | ty.key[k];
            }
        }
        return key;
    }
    buildBasis() {
        // initialize with the scalar
        let basis = [0];
        let basisMap = {0:true};

        // build the coordinate blades (e1, e2, e3, ...)
        let nb = 1;
        for(let i=0; i < this.metric.length; ++i) {
            basis[basis.length] = nb;
            basisMap[nb] = true;
            nb <<= 1;
        }

        // build the bivectors (e12, e23, ...)
        for(let i=0; i < basis.length; ++i) {
            for(let j=0; j < basis.length; ++j) {
                if(i!=j) {
                    let r = outer(basis[i], basis[j]);
                    if((r.id!=0) && !basisMap[r.id]) {
                        basis[basis.length] = r.id;
                        basisMap[r.id] = true;
                    }
                }
            }
        }

        // sort the basis by grade
        basis.sort(function(a, b) {
            let l = grade(a)-1/a;
            let r = grade(b)-1/b;
            return l<r ? -1 : 1;
        });

        return basis;
    }
    buildTypes() {
        let types = {};
        for(let i=0; i < this.basis.length; ++i) {
            let b = this.basis[i];
            let key = this.key(b);
            let name = basisString(b);
            types[name] = type(key, [b], name);
        }
        return types;
    }
    bladeTable() {
        let S = {};
        for(let i=0; i < this.basis.length; ++i) {
            let b = this.basis[i];
            let name = basisString(b);
            S[b] = {
                id: name,
                basis: b,
                gp: {}, op: {}, ip: {}
            };
        }
        return S
    }
    checkMink(x) {
        let v = x & this.values.eplane;
        return !((v == 0) || (v == this.values.eplane));
    }
    buildEuclidean() {
        let S = this.bladeTable();
        for(let i=0; i < this.basis.length; ++i) {
            let iv = this.basis[i];
            for(let j=0; j < this.basis.length; ++j) {
                let jv = this.basis[j];
                let gp = this.metricProduct(iv, jv);
                let op = outer(iv, jv);
                let ip = this.metricInner(iv, jv);

                S[iv].gp[jv] = [gp];
                S[iv].op[jv] = [op];
                S[iv].ip[jv] = [ip];
                S[iv].involute = involute(iv);
                S[iv].reverse = reverse(iv);
                S[iv].conjugate = conjugate(iv);
            }
        }
        return S;
    }
    pushMink(x) {
        if((x&this.values.no)==this.values.no) {
            let t = x^this.values.no;
            return [
                blade(t^this.values.ep, 0.5),
                blade(t^this.values.em, 0.5)
            ];
        }
        else if((x&this.values.ni)==this.values.ni) {
            let t = x^this.values.ni;
            return [
                blade(t^this.values.ep, -1),
                blade(t^this.values.em, 1)
            ];
        }
    }
    popMink(x) {
        if((x&this.values.ep)==this.values.ep) {
            let t = x^this.values.ep;
            return [
                blade(t^this.values.no, 1),
                blade(t^this.values.ni, -0.5)
            ];
        }
        else if((x&this.values.em)==this.values.em) {
            let t = x^this.values.em;
            return [
                blade(t^this.values.no, 1),
                blade(t^this.values.ni, 0.5)
            ];
        }
    }
    accumMink(blades) {
        let res = [];
        for(let i=0; i < blades.length; ++i) {
            let iv = blades[i];
            if(this.checkMink(iv.id)) {
                let minkBlades = this.popMink(iv.id);
                for(let j=0; j < minkBlades.length; ++j) {
                    let jv = minkBlades[j];
                    jv.w *= iv.w;
                }
                res = res.concat(minkBlades);
            }
            else {
                res.push(iv);
            }
        }
        return res;
    }
    buildConformalBinop(S, iv, jv) {
        // get list of blades in minkowskian (diagonal) metric
        let tmpA = this.checkMink(iv) ? this.pushMink(iv) : [blade(iv, 1)];
        let tmpB = this.checkMink(jv) ? this.pushMink(jv) : [blade(jv, 1)];

        let gpTally = [];
        let opTally = [];
        let ipTally = [];
        for(let a=0; a < tmpA.length; ++a) {
            let av = tmpA[a];
            for(let b=0; b < tmpB.length; ++b) {
                let bv = tmpB[b];
                // calculate products in mink metric
                let gp = this.metricProduct(av.id, bv.id);
                let op = outer(av.id, bv.id);
                let ip = this.metricInner(av.id, bv.id);

                // push onto tally stack
                gpTally.push(blade(gp.id, gp.w*av.w*bv.w));
                opTally.push(blade(op.id, op.w*av.w*bv.w));
                ipTally.push(blade(ip.id, ip.w*av.w*bv.w));
            }
        }

        let gpPop = this.accumMink(compress(gpTally));
        let opPop = this.accumMink(compress(opTally));
        let ipPop = this.accumMink(compress(ipTally));

        S[iv].gp[jv] = compress(gpPop);
        S[iv].op[jv] = compress(opPop);
        S[iv].ip[jv] = compress(ipPop);
    }
    buildConformalValues() {
        let no = 1<<(this.metric.length-2);
        let ni = 1<<(this.metric.length-1);
        return {
            no: no,
            ni: ni,
            ep: no,
            em: ni,
            eplane: no|ni
        }
    }
    buildConformal() {
        let S = this.bladeTable();
        for(let i=0; i < this.basis.length; ++i) {
            let ib = this.basis[i];
            S[ib].involute = involute(ib)
            S[ib].reverse = reverse(ib)
            S[ib].conjugate = conjugate(ib)

            for(let j=0; j < this.basis.length; ++j) {
                let jb = this.basis[j];
                this.buildConformalBinop(S, ib, jb)
            }
        }
        return S
    }
    buildSubspaces() {
        const _subspaceNames = [
            "Vec", "Biv", "Tri", "Quad",
            "Penta", "Hexa", "Hepta", "Octo"
        ];
        let subspaces = [];
        for(let i=0; i < this.metric.length; ++i) {
            subspaces[i] = {
                name: _subspaceNames[i],
                bases: []
            };
        }

        for(let i=0; i < this.basis.length; ++i) {
            let b = this.basis[i];
            let g = grade(b);
            if(g > 0) {
                let bases = subspaces[g-1].bases;
                bases[bases.length] = b;
            }
        }
        return subspaces;
    }
    registerSubspaces() {
        for(let i=0; i < this.subspaces.length; ++i) {
            let iv = this.subspaces[i];
            this.types[iv.name] = type(this.basesKey(iv.bases), iv.bases, iv.name);
        }
    }
    aliasType(oty, nty) {
        this.types[nty] = this.types[oty];
        this.types[oty].alias = nty;
        //this.types[oty].alias = nty
        /*delete this.types[oty];

        // rename subspace if necessary
    for(let i=0; i < this.subspaces.length; ++i) {
        let subs = this.subspaces[i];
        if(subs.name == oty) {
            subs.name = nty
            break;
        }
    }
    */
    }
    createType(bases, name, aliasExisting) {
        let key = this.basesKey(bases);
        for(let tyname in this.types) {
            let ty = this.types[tyname];
            if(keyCheck(key, ty.key)) { 
                if(aliasExisting) {
                    this.aliasType(tyname, name)
                    return name;
                }
                else {
                    return tyname;
                }
            }
        }

        this.types[name] = type(key, bases, name);
        return name;
    }
    productList(bases1, bases2, opname) {
        let tally = [];

        // fetch table pairs of values in types
        let idx = 0
        for(let i=0; i < bases1.length; ++i) {
            let iv = bases1[i];
            for(let j=0; j < bases2.length; ++j) {
                let jv = bases2[j];

                let prod = this.products[iv][opname][jv]
                for(let k=0; k < prod.length; ++k) {
                    let instruction = {
                        a: i, b: j, 
                        ida: basisString(iv),
                        idb: basisString(jv),
                        r: prod[k]
                    };
                    tally[idx] = instruction;
                    idx++;
                }
            }
        }

        let combined = {};
        // check for similar ids in the tally, or if weight is 0	
        for(let i=0; i < tally.length; ++i) {
            let instruction = tally[i];
            if(instruction.r.w == 0) continue;

            let b = instruction.r.id;
            if(combined[b]) {
                let instructions = combined[b];
                instructions[instructions.length] = instruction;
            }
            else {
                combined[b] = [instruction];
            }
        }
        return order(combined);
    }
    generateType(name) {
        let ty = this.types[name];
        let coords = basisNames(ty.bases);

        let getfields = [];
        let setfields = [];
        foreach(coords, function(v, i) {
            getfields[i] = "this["+i+"]";
            setfields[i] = getfields[i]+" = "+v;
        });

        let model = {
            name: name,
            classname: classname(name),
            parameters: coords.join(", "),
            coords: coords,
            getfields: getfields.join(", "),
            setfields: setfields,
            isdual: ty.dual,
        };
        let create = [
            "let "+model.name+" = function("+model.parameters+") {",
            "\treturn new "+model.classname+"("+model.parameters+");",
            "}"
        ].join("\n");

        let def = [
            "let "+model.classname+" = function("+model.parameters+") {",
            "\tthis.type = \""+model.name+"\";",
            "\tif(typeof "+coords[0]+" == \"object\") {",
            "\t\tthis.cast("+coords[0]+");",
            "\t}",
            "\telse {",
            model.setfields.join("\n"),
            "\t}",
            "};",
            "",
            model.classname+".prototype._cast = {};",
            model.classname+".prototype._ip = {};",
            model.classname+".prototype._op = {};",
            model.classname+".prototype._gp = {};",
            model.classname+".prototype._add = {};",
            model.classname+".prototype._sub = {};",
            "",
            model.classname+".prototype.inverse = function() {",
            "\tlet rev = this.reverse();",
            "\tlet sca = this.gp(rev)[0];",
            "\treturn rev.gp(1/sca);",
            "}",
            "",
            model.classname+".prototype.ip = function(b) {",
            "\tif(!this._ip[b.type]) {",
            "\t\tspace.createBinop('ip', this.type, b.type);",
            "\t}",
            "\treturn this._ip[b.type].call(this, b);",
            "}",
            "",
            model.classname+".prototype.op = function(b) {",
            "\tif(!this._op[b.type]) {",
            "\t\tspace.createBinop('op', this.type, b.type);",
            "\t}",
            "\treturn this._op[b.type].call(this, b);",
            "}",
            "",
            model.classname+".prototype.gp = function(b) {",
            "\tif(typeof b == \"number\") {",
            "\t\tb = space.s(b);",
            "\t}",
            "\tif(!this._gp[b.type]) {",
            "\t\tspace.createBinop('gp', this.type, b.type);",
            "\t}",
            "\treturn this._gp[b.type].call(this, b);",
            "}",
            "",
            model.classname+".prototype.sp = function(b) {",
            //"\tlet v = b.inverse().gp(this).gp(b);",
            "\tlet v = b.gp(this).gp(b.reverse());",
            "\treturn "+"new this.__proto__.constructor(v);",
            "}",
            "",
            model.classname+".prototype.re = function(b) {",
            "\tlet v = b.gp(this.involute()).gp(b.reverse());",
            "\treturn "+"new this.__proto__.constructor(v);",
            "}",
            "",
            model.classname+".prototype.div = function(b) {",
            "\treturn this.gp(b.inverse());",
            "}",
            "",
            model.classname+".prototype.add = function(b) {",
            "\tif(typeof b == \"number\") {",
            "\t\tb = space.s(b);",
            "\t}",
            "\tif(!this._add[b.type]) {",
            "\t\tspace.createAffineOp('add', this.type, b.type);",
            "\t}",
            "\treturn this._add[b.type].call(this, b);",
            "}",
            "",
            model.classname+".prototype.sub = function(b) {",
            "\tif(typeof b == \"number\") {",
            "\t\tb = space.s(b);",
            "\t}",
            "\tif(!this._sub[b.type]) {",
            "\t\tspace.createAffineOp('sub', this.type, b.type);",
            "\t}",
            "\treturn this._sub[b.type].call(this, b);",
            "}",
            "",
            model.classname+".prototype.toArray = function() {",
            "\treturn ["+model.getfields+"];",
            "}",
            "",
            model.classname+".prototype.toString = function() {",
            "\treturn \""+model.name+"(\" + this.toArray().join(\", \") + \")\";",
            "}",
            model.classname+".prototype.cast = function(b) {",
            "\tif(!this._cast[b.type]) {",
            "\t\tspace.createCast(this.type, b.type);",
            "\t}",
            "\treturn this._cast[b.type].call(this, b);",
            "}",
            "",
            model.classname+".prototype.isdual = function() {",
            "\treturn "+model.isdual+";",
            "}",
            "",
        ].join("\n");

        let code = [def];

        code.push(this.generateUnop("reverse", name));
        code.push(this.generateUnop("involute", name));
        code.push(this.generateUnop("conjugate", name));
        code.push(create);

        ty.generated = true;

        return code.join("\n\n");
    }
    createCast(toName, fromName) {
        let toTy = this.types[toName]	
        let fromTy = this.types[fromName]	

        let fromCoordMap = {}
        foreach(fromTy.bases, function(v, i) {
            fromCoordMap[v] = i;
        });

        let ops = [];
        foreach(toTy.bases, function(v, i) {
            let src;
            if(typeof fromCoordMap[v] == "number") src = "b["+fromCoordMap[v]+"]";
            else src = "0"
            ops[i] = "this["+i+"] = "+src+";"
        });

        let model = {
            classname: classname(toName),
            fromTy:fromName,
            ops: ops.join("\n")
        };

        let code = [
            model.classname+".prototype._cast."+model.fromTy+" = function(b) {",
            model.ops,
            "};"
        ].join("\n");

        new Function(classname(toName), code)(
            this.api.classes[toName]
        );
    }
    generateUnop(opname, tyname) {
        let ty = this.types[tyname]	
        let coords = basisNames(ty.bases);

        let ops = [];
        foreach(ty.bases, (v, i) => {
            let blade = this.products[v][opname];
            ops[i] = ((blade.w>0) ? "" : "-") + "this["+i+"]";
        });

        let model = {
            classname: classname(tyname),
            opname: opname,
            ops: ops.join(", ")
        };
        return [
            model.classname+".prototype."+model.opname+" = function() {",
            "\treturn new "+model.classname+"("+model.ops+");",
            "};"
        ].join("\n");
    }
    binopResultType(opname, tyname1, tyname2) {
        let ty1 = this.types[tyname1];
        let ty2 = this.types[tyname2];

        let op = this.productList(ty1.bases, ty2.bases, opname);
        return op.blades.length == 0 ?
            "s" :
            this.createType(op.blades, tyname1+tyname2+"_"+opname, false);
    }
    generateBinop(opname, tyname1, tyname2) {
        let ty1 = this.types[tyname1];
        let ty2 = this.types[tyname2];

        let op = this.productList(ty1.bases, ty2.bases, opname);
        let tynameRes = this.binopResultType(opname, tyname1, tyname2);

        let tyRes = this.types[tynameRes];
        if(!tyRes) {
            console.log("ERROR: gentype " + tyname1+tyname2+"_"+opname, op.blades);
        }
        else if(this.initialized && !tyRes.generated) {
            // TODO: consolidate this with the generate() function
            let code = this.generateType(tynameRes);
            let functionBody = ["let api = { classes:{}, constructors:{} };"];
            functionBody.push([
                code,
                "api.constructors."+tynameRes+" = "+tynameRes+";",
                "api.classes."+tynameRes+" = "+classname(tynameRes)+";"
            ].join("\n")
            );

            functionBody.push("return api;");
            let f = new Function("space", functionBody.join("\n\n"));
            let api = f(this);
            for(let name in api.classes) {
                this.api.classes[name] = api.classes[name];
            }
            for(let name in api.constructors) {
                this.api.constructors[name] = api.constructors[name];
            }
        }

        let ops = [];
        if(op.blades.length == 0) {
            ops[0] = "0";
        }
        else {
            for(let i=0; i < op.blades.length; ++i) {
                let blade = op.blades[i];
                let inst = op.inst[blade];
                let instbops = [];
                for(let j=0; j < inst.length; ++j) {
                    let instop = inst[j];
                    let bop = "this["+instop.a+"]*b["+instop.b+"]";
                    if(instop.r.w < 0) bop = "-"+bop;
                    instbops.push(bop);
                }
                ops.push(instbops.join(" + "));
            }
        }

        let model = {
            classname1: classname(tyname1),
            tyname2: tyname2,
            opname: opname,
            tynameRes: tynameRes,
            ops: ops.join(",\n")
        };
        return [
            model.classname1+".prototype._"+model.opname+"."+model.tyname2+" = function(b) {",
            "\treturn "+model.tynameRes+"("+model.ops+");",
            "};"
        ].join("\n");
    }
    createBinop(opname, tyname1, tyname2) {
        let resultType = this.binopResultType(opname, tyname1, tyname2);
        let code = this.generateBinop(opname, tyname1, tyname2);
        new Function(classname(tyname1), resultType, code)(
            this.api.classes[tyname1], this.api.constructors[resultType]
        );
    }
    createAffineOp(opname, tyname1, tyname2) {
        let opsym = opname == "add" ? "+" : "-";

        let ty1 = this.types[tyname1];
        let ty2 = this.types[tyname2];
        let bases1Map = {};
        let bases2Map = {};
        let basesMap = {};
        for(let i=0; i < ty1.bases.length; ++i) {
            bases1Map[ ty1.bases[i] ] = i;
            basesMap[ ty1.bases[i] ] = ty1.bases[i];
        }
        for(let i=0; i < ty2.bases.length; ++i) {
            bases2Map[ ty2.bases[i] ] = i;
            basesMap[ ty2.bases[i] ] = ty2.bases[i];
        }
        let bases = [];
        for(let name in basesMap) {
            bases.push(basesMap[name]);
        }
        bases.sort(function(a, b) {
            return (a<b) ? -1 : 1;
        });
        let ops = [];

        for(let i=0; i < bases.length; ++i) {
            let operands = [];
            let second = false;
            if(bases1Map[ bases[i] ] != undefined) {
                operands.push("this["+bases1Map[ bases[i] ]+"]");
            }
            if(bases2Map[ bases[i] ] != undefined) {
                second = true;
                operands.push("b["+bases2Map[ bases[i] ]+"]");
            }
            let op;
            if(operands.length == 2) {
                op = operands.join(opsym);
            }
            else {
                op = operands[0];
                if(second && opname == "sub") {
                    op = opsym+op;
                }
            }
            ops[i] = op;
        }

        let tynameRes = this.createType(bases, tyname1+tyname2+"_"+opname, false);
        let tyRes = this.types[tynameRes];
        if(this.initialized && !tyRes.generated) {
            // TODO: consolidate this with the generate() function
            let code = this.generateType(tynameRes);
            let functionBody = ["let api = { classes:{}, constructors:{} };"];
            functionBody.push([
                code,
                "api.constructors."+tynameRes+" = "+tynameRes+";",
                "api.classes."+tynameRes+" = "+classname(tynameRes)+";"
            ].join("\n")
            );

            functionBody.push("return api;");
            let f = new Function("space", functionBody.join("\n\n"));
            let api = f(this);
            for(let name in api.classes) {
                this.api.classes[name] = api.classes[name];
            }
            for(let name in api.constructors) {
                this.api.constructors[name] = api.constructors[name];
            }
        }

        let model = {
            classname1: classname(tyname1),
            tyname2: tyname2,
            opname: opname,
            tynameRes: tynameRes,
            ops: ops.join(", ")
        };

        let code = [
            model.classname1+".prototype._"+model.opname+"."+model.tyname2+" = function(b) {",
            "\treturn "+model.tynameRes+"("+model.ops+");",
            "};"
        ].join("\n");

        new Function(classname(tyname1), tynameRes, code)(
            this.api.classes[tyname1], this.api.constructors[tynameRes]
        );
    }
    generateRegisteredTypes() {
        let code = {};
        for(let name in this.types) {
            let ty = this.types[name];
            if(!ty.generated) {
                code[name] = this.generateType(name);
            }
            else {
                code[name] = [
                    "let "+classname(name)+" = "+classname(ty.name)+";",
                    "let "+name+" = "+ty.name+";"
                ].join("\n");
            }
        }
        return code;
    }
    generateBinops(binops) {
        let code = [];
        foreach(
            binops, (v, i) => {
                code[i] = this.generateBinop(
                    v.op, v.types[0], v.types[1]
                );
            }
        );
        return code;
    }
    createTypes(types) {
        for(let i=0; i < types.length; ++i) {
            let ty = types[i];
            let name = this.createType(basisBits(ty.bases), ty.name, true);
            if(ty.dual != undefined) {
                this.types[name].dual = ty.dual;
            }
        }
    }
    ip(a, b) { return a.ip(b); }
    op(a, b) { return a.op(b); }
    gp(a, b) {
        if(typeof a == "number") {
            a = this.s(a);
        }
        return a.gp(b);
    }
    sp(a, b) { return a.sp(b); }
    isSubType(tyname1, tyname2) {
        let bases1 = this.types[tyname1].bases;
        let bases2 = this.types[tyname2].bases;

        let bases1Map = {};
        for(let i=0; i < bases1.length; ++i) {
            bases1Map[ bases1[i] ] = true;
        }
        for(let i=0; i < bases2.length; ++i) {
            if(!bases1Map[ bases2[i] ]) {
                return false;
            }
        }
        return true;
    }
}
