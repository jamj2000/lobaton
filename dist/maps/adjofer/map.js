/**
 * @name MapAdjOfer
 * @class
 * @hideconstructor
 * @classdesc Implementa un mapa que muestra la adjudicación de vacantes provisionales
 * y la oferta educativa de los centros públicos dependientes de la Junta de Andalucía.
 *
 * @param {String} id  Identificador del elemento HTML
 * donde se incrustará el mapa.
 * @param {Obj} opts Opciones de configuración.
 * @param {String} opts.path Ruta relativa desde el directorio en que
 * se encuentra la página web al directorio ``dist``.
 * @param {Boolean} opts.light Si ``true``, define el comportamiento del evento
 * *click* como "seleccionar el centro pulsado" y el evento *contextmenu* muestra
 * un menú contextual que permite generar crear rutas e isocronas. Esto libera de
 * tener que realizar en la interfaz la definición de cómo seleccionar centro y cómo
 * ordenar que se creen rutas e isocronas.
 * @param {String} opts.ors  La clave para el uso de los servios de OpenRouteService.
 * @param {Function} opts.chunkProgress   Función que se ejecuta periódicamente
 * si se demora demasiado la creación de las isoronas.
 */
const mapAdjOfer = (function(path, opts) {
   "use strict";

   // Issue #27
   /**
    * Crea una propiedad a la que se asocia un tipo de evento,
    * de manera que cuando se le da valor a la propiedad se lanzan
    * las acciones asociadas al evento *on*, y cuando se da valor null
    * se lanzan las acciones asociadas al evento *off*.
    *
    * @this El objeto al que se asocia el atributo.
    * @param {String} attr  El nombre del atributo que se creará.
    * @param {String} tipo  Nombre del tipo.
    * @param {*}  value     Valor inicial
    */
   function crearAttrEvent(attr, tipo, value=null) {
      if(this.fire === undefined) throw new Error("El objeto no puede lanzar eventos");

      addDescriptor(this, "_" + attr, value, true);
      Object.defineProperty(this, attr, {
         get: function() { return this["_" + attr]; },
         set: function(value) {
            const old = this[attr];
            this["_" + attr] = value;
            this.fire(tipo, {oldval: old, newval: value});
         },
         configurable: false,
         enumerable: true
      });
   }
   // Fin issue #27;


   /**
    * Define una propiedad mediante un descriptor que no configurable ni enumerable.
    *
    * @param {Object} obj        Objeto en el que se define el descritor
    * @param {String}  name      Nombre de la propiedad
    * @param {Boolean} writable  Define si es o no escribible.
    */
   function addDescriptor(obj, name, value, writable) {
      Object.defineProperty(obj, name, {
         value: value,
         writable: !!writable,
         enumerable: false,
         configurable: false
      });
   }


   // Obtiene una gama de colores RGB distinguibles entre sí.
   // En principio, si se desea obtener 4 colores, habrá que pasar:
   // como ratio 1/4, 2/4, 3/4 y 4/4.
   function HSLtoRGB(h, s, l) {
      s = s || .65;
      l = l || .45;

      var r, g, b;

      if(s == 0){
         r = g = b = l;
      }
      else {
         function hue2rgb(p, q, t) {
            if(t < 0) t += 1;
            if(t > 1) t -= 1;
            if(t < 1/6) return p + (q - p) * 6 * t;
            if(t < 1/2) return q;
            if(t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
         }

         var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
         var p = 2 * l - q;
         r = hue2rgb(p, q, h + 1/3);
         g = hue2rgb(p, q, h);
         b = hue2rgb(p, q, h - 1/3);
      }

      return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
   }

   // Convierte un array de tres enteros (RGB) en notación hexadecimal.
   function rgb2hex(rgb) {
      return "#" + rgb.map(dec => ("0" + dec.toString(16)).slice(-2)).join("");
   }


   const MapAdjOfer = L.Evented.extend({
      /** @lends MapAdjOfer.prototype */

      options: {
         id: "map",
         center: [37.07, -6.27],
         zoom: 9,
         light: true,      // Issue #41
         search: true,     // Issue #51
         ors: false,       // Issue #42
         icon: "boliche"   // Estilo con que se definen las nuevas marcas.
      },

      statics: {
      },

      initialize: function(options) {
         L.Util.setOptions(this, options);
         loadMap.call(this);
         createMarker.call(this);
      },

      /**
       * Cambia el estilo de icono de todos las marcas de centro existentes.
       * En cambio, si la pretensión fuera empezar a dibujar marcas con
       * distinto estilo de icono, habría que hacer:
       *
       * @example
       *
       * mapadjofer.options.icon = "otro_estilo";
       *
       * @param {String} estilo     El estilo deseado para el icono.
       */
      setIcon: function(estilo) {
         const Icono = catalogo[estilo];
         if(!Icono) throw new Error(`${estilo}: Estilo de icono desconocido`);

         Icono.onready(() => this.Centro.store.forEach(m => m.setIcon(new Icono())));
         this.options.icon = estilo;

         return this;
      },

      /**
       * Agregar centros al mapa.
       *
       * @param {String|Object} datos  Datos en formato GeoJSON o URL donde conseguirlos.
       */
      agregarCentros: function(datos) {
         const Icono = catalogo[this.options.icon];
         Icono.onready(() => {
            if(typeof datos === "string") {  // Es una URL.
               L.utils.load({
                  url: datos,
                  callback: xhr => {
                     const datos = JSON.parse(xhr.responseText);
                     this.agregarCentros(datos);
                  }
               });
            }
            else {
               this.general = datos.features[0].properties;
               // Capa intermedia capaz de leer objetos GeoJSON.
               const layer = L.geoJSON(datos, {
                  pointToLayer: (f, p) => {
                     const centro = new this.Centro(p, {
                        icon: new Icono(),
                        title: f.properties.id.nom
                     });

                     // Issue #33
                     // Para cada centro que creemos hay que añadir a los datos
                     // la propiedad que indica si la marca está o no seleccionada.
                     centro.on("dataset", e => e.target.changeData({sel: false}));

                     // Issue #41
                     if(this.options.light) centro.once("dataset", e => {
                        centro.on("click", e => {
                           this.seleccionado = this.seleccionado === e.target?null:e.target
                        });
                     });
                     // Fin issue #41, #33

                     return centro;
                  },
                  onEachFeature: (f, l) => {
                     if(this.options.light) l.bindContextMenu(contextMenuCentro.call(this, l));
                  }
               });

               this.cluster.addLayer(layer);
               this.fire("dataloaded");
            }
         });
      },
      /**
       * Calcula la dirección postal del origen
       */
      calcularOrigen: function() {
         if(!this.origen) return;
         this.geoCodificar(this.origen.getLatLng());
         this.once("addressset", e => {
            if(typeof this.direccion === "string") this.origen.postal = this.direccion;
         });
         // Deshabilitamos inmediatamente en el menú contextual
         // la entrada correspondiente a geolocalizar el origen.
         if(this.options.light) {
            this.origen.unbindContextMenu();
            this.origen.bindContextMenu(contextMenuOrigen.call(this));
         }
      },
      /**
       * Establece el origen de los viajes.
       *
       * @param {L.LatLng} latlng  Coordenadas en las que fijarlo.
       */
      setOrigen: function(latlng) {
         if(latlng) {
            this.origen = new L.Marker(latlng, {
               title: `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`
            });
            if(this.options.light) {
               this.origen.bindContextMenu(contextMenuOrigen.call(this));
            }
         }
         else this.origen = null;
      },
      /**
       * Establece las isocronas referidas al origen
       */
      setIsocronas: function(a) {
         this.isocronas = !!a;
         if(a && this.options.light && this.origen) {
            this.origen.unbindContextMenu();
            this.origen.bindContextMenu(contextMenuOrigen.call(this));
         }
      },
      /**
       * Establece la ruta entre el origen y un centro
       */
      setRuta: function(centro) {
         this.ruta = centro;
         if(centro && this.options.light && this.origen) {
            this.origen.unbindContextMenu();
            this.origen.bindContextMenu(contextMenuOrigen.call(this));
         }
      },
      geoCodificar: function(query) {
         this.direccion = query
      }
   });


   /**
    * Carga el mapa y crea la capa de cluster donde se agregan los centros.
    * @this {MapAdjOfer.prototype} El objeto que implemnta el mapa
    * @private
    */
   function loadMap() {

      const options = {},
            nooptions = ["light", "ors", "id", "search", "icon"];

      for(const name in this.options) {
         if(nooptions.indexOf(name) !== -1) continue
         options[name] = this.options[name];
      }

      if(this.options.light) Object.assign(options, contextMenuMap.call(this));

      this.map = L.map(this.options.id, options);
      this.map.zoomControl.setPosition('bottomright');
      this.map.addControl(new L.Control.Fullscreen({position: "topright"}));

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18
      }).addTo(this.map);

      /**
       * Capa donde se agregan las marcas
       * @memberof MapaAdjOfer.prototype
       * @type {L.MarkerClusterGroup}
       */
      this.cluster = L.markerClusterGroup({
         showCoverageOnHover: false,
         // Al llegar a nivel 14 de zoom se ven todas las marcas.
         disableClusteringAtZoom: 14,
         spiderfyOnMaxZoom: false,
         iconCreateFunction: L.utils.noFilteredIconCluster
      }).addTo(this.map);

      if(this.options.search) this.map.addControl(createSearchBar.call(this));  // Issue #51

      // Issue #27
      crearAttrEvent.call(this, "origen", "originset");
      crearAttrEvent.call(this, "seleccionado", "markerselect");
      // Fin issue #27

      // Aplicación de issue #33: Cambiamos la marca
      // al seleccionarla o deseleccionarla.
      this.on("markerselect", function(e) {
         if(e.oldval) {
            e.oldval.changeData({sel: false});
            e.oldval.refresh();
         }
         if(e.newval) {
            e.newval.changeData({sel: true});
            e.newval.refresh();
         }
      });

      // Al seleccionar/deseleccionar, hay que cambiar los
      // menús contextuales de las marcas implicadas y
      // el del origen (su entrada sobre rutas).
      this.on("markerselect", e => {
         if(!this.options.light) return;
         for(const c of [e.oldval, e.newval]) {
            if(c) {
               c.unbindContextMenu();
               c.bindContextMenu(contextMenuCentro.call(this, c));
            }
         }
         if(this.origen) {
            this.origen.unbindContextMenu();
            this.origen.bindContextMenu(contextMenuOrigen.call(this));
         }
      });

      // Fijar un origen, implica crear una marca sobre
      // el mapa y destruir la antigua.
      this.on("originset", e => {
         if(e.oldval) e.oldval.removeFrom(this.map);
         if(e.newval) e.newval.addTo(this.map);
      });

      if(this.options.ors) {
         /**
          * Objecto de acceso a los servicios de OpenRouteService.
          * @memberof {MapAdjOfer.prototype}
          * @type {ORS}
          */
         this.ors = ORS(this);
         Object.defineProperty(this, "ors", {writable: false, configurable: false});

         crearAttrEvent.call(this, "contador", "counteradd", 0);

         Object.defineProperties(this, {
            /** @lends MapAdjOfer.prototype */
            "isocronas": {
               get: function() {
                  return this.ors.isocronas.areas;
               },
               set: function(value) {  // true crea isocronas; null las elimina.
                  const old = this.isocronas,
                        origen_old = this.ors.isocronas.calc.origem;
                  if(value) {
                     this.ors.isocronas.create().then((response) => {
                        if(response || response === undefined) this.contador++;
                        if(response !== null) { 
                           this.fire("isochroneset", {oldval: old, newval: this.isocronas});
                        }
                     });
                  }
                  else {
                     this.ors.isocronas.remove();
                     this.fire("isochroneset", {oldval: old, newval: this.isocronas});
                  }
               },
               enumerable: true,
               configurable: false
            },
            // Issue #46
            "direccion": {
               get: function() {
                  return this.ors.geocode.value;
               },
               set: function(value) {  // Cadena con la dirección o coordenadas.
                  const old = this.ors.geocode.value;
                  if(value) {
                     this.ors.geocode.query(value).then((response) => {
                        if(response !== null) {
                           this.contador++;
                           this.fire("addressset", {oldval: old, newval: value});
                        }
                     });
                  }
                  else console.warn("No tiene sentido calcular con valor nulo una dirección");
               },
               enumerable: true,
               configurable: false
            },
            // Fin issue #46
            // Issue #47
            "ruta": {
               get: function() {
                  return this.ors.ruta.value;
               },
               set: function(destino) {
                  const old = this.ruta;
                  if(destino) {
                     this.ors.ruta.create(destino).then((response) => {
                        if(response || response === undefined) this.contador++;
                        if(response !== null) { 
                           this.fire("routeset", {oldval: old, newval: this.ruta});
                        }
                     });
                  }
                  else {
                     this.ors.ruta.remove();
                     this.fire("routeset", {oldval: old, newval: this.ruta});
                  }

               },
               enumerable: true,
               configurable: false
            }
            // Fin issue #47
         });
         
         // modifica el menú contextual del origen.
         this.on("isochroneset", e => {
            if(this.options.light && this.origen) {
               this.origen.unbindContextMenu();
               this.origen.bindContextMenu(contextMenuOrigen.call(this));
            }
         });

         // Issue #46
         // Asociamos un evento "geocode" al momento en que
         // averiguamos la dirección postal del origen.
         this.on("originset", e => {
            if(!e.newval) return;
            crearAttrEvent.call(e.newval, "postal", "geocode");
            // Incluimos la dirección como title y deshabilitamos
            // la posibilidad de obtenerla a través del menú contextual.
            e.newval.on("geocode", x => {
               e.newval.getElement().setAttribute("title", x.newval);
               if(this.options.light) {
                  e.newval.unbindContextMenu();
                  e.newval.bindContextMenu(contextMenuOrigen.call(this));
               }
            });
         });

         // Elimina la isocrona al fijar un nuevo origen.
         this.on("originset", e => this.setIsocronas(null));
         // Fin issue #46

         // Issue #47
         this.on("routeset", e => {
            if(!this.options.light) return;

            if(e.newval) {
               const destino = e.newval.destino;
               destino.unbindContextMenu();
               destino.bindContextMenu(contextMenuCentro.call(this, destino));
            }
            if(e.oldval) {
               const destino = e.oldval.destino;
               destino.unbindContextMenu();
               destino.bindContextMenu(contextMenuCentro.call(this, destino));
            }
            if(this.options.light && this.origen) {
               this.origen.unbindContextMenu();
               this.origen.bindContextMenu(contextMenuOrigen.call(this));
            }
         });
         // Al cambiar de origen, hay que cambiar los menús contextuales de
         // todas las marcas, ya que no tiene sentido la entrada de crear ruta.
         this.on("originset", e => {
            if(this.ruta) this.setRuta(null);

            if(!this.options.light) return;
            for(const c of this.Centro.store) {
               c.unbindContextMenu();
               c.bindContextMenu(contextMenuCentro.call(this, c));
            }
         });
         // Fin issue #47

      }

   }

   /**
   Crea la clase de marca para los centros y le
   * añade las correcciones y filtros definidos para ella.
   * @this {MapAdjOfer} El objeto que implemnta el mapa
   * @private
   */
   function createMarker() {
      /**
      * Clase de marca para los centros educativos.
      * @memberof MapAdjOfer.prototype
      * @type {Marker}
      */
      this.Centro = L.Marker.extend({
       options: {
          mutable: "feature.properties",
          filter: this.cluster,
          //filter: "filtered",
          //filter: L.utils.grayFilter
       }
      });

      createCorrections.call(this);
      createFilters.call(this);
   }


   // Issue #51
   function createSearchBar() {
      // CodidoProvincial: Nombre del instituto
      const label = (d) => `${String(d.id.cp).substring(0,2)}: ${d.id.nom}`;

      const control = new L.Control.Search({
         position: "topright",
         textPlaceholder: "Busque por nombre",
         textErr: "No encontrado",
         initial: false,
         // Así nos aseguramos que se ve la marca seleccionada.
         zoom: this.cluster.options.disableClusteringAtZoom,
         marker: false,
         minLength: 3,
         sourceData: (text, callback) => {
            callback(this.cluster.getLayers().map(m => {
               const data = m.getData();
               return {
                  title: label(data),
                  loc: m.getLatLng()
               }
            }));

            return { abort: function() {}}
         },
         filterData: (text, records)  => {
            const ret = {},
            pathData = this.Centro.prototype.options.mutable,
            coincidentes = new Fuse(
               this.cluster.getLayers(), {
                  keys: [pathData + ".id.nom"],
                  minMatchCharLength: 2,
               }).search(text);

            for(const idx in coincidentes) {
               const data = coincidentes[idx].getData(),
                     title = label(data),
                     centro = records[title];

               if(!centro) continue;

               ret[title] = centro;
               // Encchufamos la marca del centro para tenerla
               // disponible en el evento search:locationfound.
               centro.layer = coincidentes[idx];
            }

            return ret;
         }
      });

      control.on("search:locationfound", e => {
         this.seleccionado = e.layer;
         control.collapse();
      });

      return control;
   }
   // Fin issue #51


   /**
   * Define el menú contextual del mapa.
   * @this {MapAdjOfer}  El objeto del mapa de adjudicaciones.
   */
   function contextMenuMap() {
      return {
         contextmenu: true,
         contextmenuItems: [
            {
               text: "Fijar origen de viaje",
               callback: e => this.setOrigen(e.latlng)
            },
            {
               text: "Centrar el mapa aquí",
               callback: e => this.map.panTo(e.latlng)
            },
            "-",
            {
               text: "Ampliar escala",
               icon: path + "/maps/adjofer/images/zoom-in.png",
               callback: e => this.map.zoomIn()
            },
            {
               text: "Reducir escala",
               icon: path + "/maps/adjofer/images/zoom-out.png",
               callback: e => this.map.zoomOut()
            }
         ]
      }
   }


   /**
   * Define el menú contextual del punto de origen
   * @this {MapAdjOfer}  El objeto del mapa de adjudicaciones.
   *
   * @param {String} espera  Cuál es la acción por la que se está esperando.
   */
   function contextMenuOrigen() {
      const items = [
         {
            text: "Geolocalizar este origen",
            disabled: !!this.origen.postal || this.ors.espera.indexOf("geocode") !== -1,
            callback: e => this.calcularOrigen()
         }
      ]

      if(this.isocronas) {
         items.push({
            text: "Eliminar isocronas",
            callback: e => this.setIsocronas(null)
         });
      }
      else {
         items.push({
            text: "Generar isocronas",
            disabled: this.ors.espera.indexOf("isocronas") !== -1,
            callback: e => this.setIsocronas(true)
         });
      }

      if(this.ruta || this.ors.espera.indexOf("ruta") !== -1) {
         items.push({
            text: "Eliminar ruta",
            disabled: this.ors.espera.indexOf("ruta") !== -1,
            callback: e => this.setRuta(null)
         });
      }
      else {
         items.push({
            text: "Crear ruta al centro seleccionado",
            disabled: !this.seleccionado,
            callback: e => this.setRuta(this.seleccionado)
         });
      }

      items.push.apply(items, [
         "-",
         {
            text: "Eliminar este origen",
            callback: e => this.setOrigen(null)
         }
      ]);

      return {
         contextmenu: true,
         contextmenuInheritItems: false,
         contextmenuItems: items
      }
   }

   function contextMenuCentro(marker) {

      const seleccion = this.seleccionado !== marker,
            texto = (seleccion?"Seleccionar":"Deseleccionar") + " el centro",
            items = [
               {
                  text: texto,
                  callback: e => this.seleccionado = (seleccion?marker:null)
               }
            ]

      if(this.ruta && this.ruta.destino === marker) {
         items.push({
            text: "Eliminar la ruta",
            callback: e => this.setRuta(null)
         });
      }
      else {
         items.push({
            text: "Crear ruta desde el origien",
            disabled: !this.origen || this.ors.espera.indexOf("ruta") !== -1,
            callback: e => this.setRuta(marker)
         });
      }

      return {
         contextmenu: true,
         contextmenuInheritItems: false,
         contextmenuItems: items
      }
   }


   /**
    * Registra las correcciones disponibles.
    * @this {MapAdjOfer} El objeto que implemnta el mapa
    * @private
    */
   function createCorrections() {
      const self = this;
      // Elimina enseñanzas que no son bilingües
      this.Centro.register("bilingue", {
         attr: "oferta",
         // opts= { bil: ["Inglés", "Francés"] } => Filtra enseñanzas que no sean bilingues de francés o inglés.
         func: function(idx, oferta, opts) {
            if(!opts.bil || opts.bil.length === 0) return false;
            return opts.bil.indexOf(oferta[idx].idi) === -1
         },
         // Sólo son pertinentes los puestos bilingües.
         chain: [{
            corr: "adjpue",
            func: function(opts) {
               const map = {  // TODO: Esto debería sacarse de la base de datos y estar en el geoJSON
                  "Francés": 10,
                  "Inglés": 11,
                  "Alemán": 12
               };
               const cod = Object.keys(map)
                                 .filter(idi => opts.bil.indexOf(idi) !== -1)
                                 .map(e => map[e]);
               //Puestos a eliminar.
               const puestos = Object.keys(self.general.puestos)
                                     .filter(pue => !cod.some(c => pue.startsWith(c)));
               return puestos.length>0?{puesto: puestos}:false;
            }
         }]
      });

      // Añade vacantes telefónicas a las adjudicaciones.
      this.Centro.register("vt+", {
         attr: "adj",
         add: true,
         func: function(idx, adj, opts) {
            const data = this.getData(),
                  res = [];
            for(const puesto in data.pla) {
               for(let i=0; i<data.pla[puesto].vt; i++) res.push({
                  col: "J",
                  esc: [0, 0, 0],
                  pue: puesto,
                  pet: null,
                  // TODO:: ¿Qué narices es esto?
                  per: false,
                  ubi: false
               });
            }
            return res;
         }
      });

      // Elimina las adjudicaciones de los puestos suministrados.
      this.Centro.register("adjpue", {
         attr: "adj",
         // opts= {puesto: ["00590059", "11590107"], inv: false}
         func: function(idx, adj, opts) {
            return !!(opts.inv ^ (opts.puesto.indexOf(adj[idx].pue) !== -1));
         }
      });

      // Elimina las enseñanzas suministradas
      this.Centro.register("ofens", {
         attr: "oferta",
         // opts= {ens: ["23GMSMR168", "23GSASI820"], inv: false}
         func: function(idx, oferta, opts) {
            return !!(opts.inv ^ (opts.ens.indexOf(oferta[idx].ens) !== -1));
         },
         chain: [{
            corr: "adjpue",
            // Si alguna de las enseñanzas eliminadas, es la única
            // que puede impartir un puesto, entonces debe eliminarse tal puesto.
            func: function(opts) {
               const ens = self.general.ens;
               // Interesan las enseñanzas que no se eliminan.
               if(!opts.inv) opts = {ens: Object.keys(ens).filter(e => opts.ens.indexOf(e) === -1)};

               // Puestos impartidos exclusivamente por las enseñanzas eliminadas.
               const pue = [];
               for(let p of self.general.puestos) {
                  let impartido = false;
                  for(let e of opts.ens) {
                     if(ens[e].puestos.indexOf(p) !== -1) {
                        impartido = true;
                        break;
                     }
                  }
                  if(!impartido) pue.push(p);
               }

               return pue.length?{puesto: pue}:false;
            }
         }]
      });

      // Elimina adjudicaciones no telefónicas.
      this.Centro.register("vt", {
         attr: "adj",
         // Las peticiones telefónicas son las que tiene pet=null
         func: (idx, adj, opts) => adj[idx].pet !== null
      });

      // Elimina adjudicaciones que no responden a vacantes iniciales.
      this.Centro.register("vi", {
         attr: "adj",
         // opts= {}
         func: function(idx, adj, opts) {
            const puesto = adj[idx].pue,
                  vi = this.getData().pla[puesto].vi;
            let i, num = 0;
            for(i=0; i<=idx; i++) {
               if(adj[i].pue === puesto) num++;
            }
            return i>vi;
         }
      });

      // Elimina las enseñanzas no deseables.
      /*
      this.Centro.register("deseable", {
         attr: "oferta",
         func: (idx, oferta, opts) => !oferta[idx].mar
      });
      */
      // Esta implementación alternativa tiene la ventaja
      // de que está expresada en términos de enseñanzas (ofens).
      this.Centro.register("deseable", {
         attr: "oferta",
         autochain: true,
         func: opts => false,
         chain: [{
            corr: "ofens",
            func: function(opts) {
               // Hay que montar este cirio, porque la característica mar (deseable)
               // aparece en las enseñanzas de centro, pero no en la relación general
               // de enseñanzas. Debería corregirse el geojson.
               const indeseables = [];
               for(const ens in self.general.ens) {
                  for(const c of this.store) {
                     let found = false;
                     for(const o of c.getData().oferta) {
                        if(o.ens === ens) {
                           found = true;
                           if(!o.mar) indeseables.push(ens);
                           break;
                        }
                     }
                     if(found) break;
                  }
               }
               return indeseables.length?{ens: indeseables}:false;
            }
         }]
      });

      // Elimina las enseñanzas que no sean del turno indicado.
      this.Centro.register("turno", {
         attr: "oferta",
         // opts= {turno: 1, inv: true}  => 1: mañana, 2: tarde: 3, ambos.
         func: function(idx, oferta, opts) {
            if(oferta[idx].tur === null) return false; // Semipresenciales
            const map = {
               "matutino": 1,
               "vespertino": 2,
               "ambos": 3
            }
            // ESO y BAC noo tiene turno,
            // pero si es enseñanza de adultos es por la tarde.
            const turno = map[oferta[idx].tur || (oferta[idx].adu?"vespertino":"matutino")];

            return !!(opts.inv ^ !(turno & opts.turno));
         }
      });

      // Función para comprobar el adjudicatario de referencia.
      function adjref(idx, adj, opts) {
         // Pasa el tiempo de servicio a un pseudoescalafon:
         // Debe cumplir que a mayor tiempo de servicio, menor escalafón.
         function ts2esc(ts) {
            const hoy = new Date();

            return hoy.getFullYear() +
                   String(hoy.getMonth()).padStart(2, "0") +
                   String(hoy.getDate()).padStart(2, "0") -
                   ts.map(e => String(e).padStart(2, "0")).join("");
         }

         // Calcula un escalafón intercolectivo. Está constituido por la
         // concatenación de:
         // - Una primera parte que identifica la prioridad del colectivo.
         //   (1, el más prioritario; 2 el segundo, etc.)
         // - Un escalafón que se calcula del siguiente modo:
         //     + El propio escalafón, si es un func. de carrera que no ha
         //       cogido nunca excedencia.
         //     + Para interinos, funcionarios sin escalafón o funcionarios
         //       que en algún momento cogieron excedencia, un
         //       escalafón obtenido con ts2esc().
         function escEquiv(opts) {
            let esc = opts.esc,
                ts = opts.ts,
                col = String(self.general.colectivos[opts.col].o);

            // TODO: En el geojson los interinos deberían tener su ts
            // en la propiedad ts; y los funcionarios tener un esc y un ts.
            if(opts.col === "J") {
               if(esc && esc.length) {  // Precaución: los interinos tiene ts en esc.
                  ts = esc;
                  esc = undefined;
               }
            }
            else if(ts !== undefined) {  // Func. de carrera con dato de ts.
               const aa = (new Date()).getFullYear() - esc.substring(0, 4) - 1;
               // Esto significa que nunca ha cogido excendencia
               if(aa === ts[0]) ts = undefined;
            }

            if(ts !== undefined) esc = ts2esc(ts);

            return Number(col + esc);
         }

         if(!opts.hasOwnProperty("_ref")) opts._ref = escEquiv(opts);
         return escEquiv(adj[idx]) > opts._ref;
      }

      // Elimina las adjudicaciones que sean más prioritarias
      // que el adjudicatario de referencia que se defina.
      this.Centro.register("adjref", {
         attr: "adj",
         // opts= {ts: [10, 3, 22], esc: 20104120, col: "DB"}
         // ts=tiempo-servicio (aa-mm-dd), esc=escalafon, col=colectivo
         func: adjref
      });

      // Elimina enseñanzas que no sean nuevas
      this.Centro.register("nueva", {
         attr: "oferta",
         func: function(idx, oferta, opts) {
            return oferta[idx].nue === 0;
         }
      });

   }

   /**
    * Registra los filtros definidos para este tipo de mapa.
    * @this {MapAdjOfer} El objeto que implemnta el mapa
    * @private
    */
   function createFilters() {
      // Filtra según cantidad de adjudicaciones.
      this.Centro.registerF("adj", {
         attrs: "adj",
         // opts= {min: 0}
         func: function(opts) {
             return this.getData().adj.total < opts.min;
         }
      });

      // Filtra según número de enseñanzas.
      this.Centro.registerF("oferta", {
         attrs: "oferta",
         // opts= {min: 0}
         func: function(opts) {
             return this.getData().oferta.total < opts.min;
         }
      });

      // Elimina los tipos facilitados
      this.Centro.registerF("tipo", {
         attrs: "mod.dif",
         // opts= {tipo: 1, inv: false}  //tipo: 1=compensatoria, 2=difícil desempeño, 3=ambos.
         func: function(opts) {
            const map  = { "compensatoria": 1, "dificil": 2 },
                  tipo = map[this.getData().mod.dif] || 0;

            return !!(opts.inv ^ !!(tipo & opts.tipo));
         }
      });

      // Elimina las marcas que se hallen fuera del área
      this.Centro.registerF("lejos", {
         attrs: "no.existe",
         // opts={area: geojson}
         func: function(opts) {
            const latlng = this.getLatLng(),
                  point = {
                     type: "Feature",
                     geometry: {
                        type: "Point",
                        coordinates: [latlng.lng, latlng.lat]
                     }
                  }

            return !turf.booleanPointInPolygon(point, opts.area);
         }
      });

      // Al eliminar las isocronas, desaplicamos el filtro lejos.
      this.on("isochroneset", e => {
         if(!e.newval && this.Centro.hasFilter("lejos")) {
            this.Centro.unfilter("lejos");
            this.Centro.invoke("refresh");
         }
      });
   }


   /**
    * Define el catálogo de iconos disponibles
    */
   const catalogo = (function () {
      // Los dos iconos CSS comparten todo, excepto el estilo CSS.
      const converterCSS = new L.utils.Converter(["numvac", "tipo"])
                                 .define("tipo", "mod.dif", t => t || "normal")
                                 .define("numvac", "adj", a => a.total !== undefined?a.total:a.length);

      const html = document.querySelector("template").content;

      function updaterCSS(o) {
         const content = this.querySelector(".content");
         if(o.tipo) content.className = "content " + o.tipo;
         if(o.numvac !== undefined) content.firstElementChild.textContent = o.numvac;
         return this;
      }

      const converterSol = new L.utils.Converter(["peticion"]).define("peticion");

      // Los boliches tienen mucha miga...
      const converterBol = new L.utils.Converter(["numvac", "tipo", "numofer", "bil", "ofervar", "sel"])
                                 .define("tipo", "mod.dif", t => t || "normal")
                                 .define("numvac", "adj", a => a.total)
                                 .define("ofervar", "mod.cam", c => c || 0)
                                 .define("sel");

      // Para calcular la cantidad de oferta se considera
      // 1 una enseñanza deseable y 1/3 una que no lo es.
      converterBol.define("numofer", "oferta", function(oferta) {
         let res = 0;
         for(const ens of oferta) {
            if(ens.filters.length>0) continue
            res += ens.mar?3:1;
         }
         return Math.round(res/3);
      });

      converterBol.define("bil", "oferta", function(oferta) {
         // Array.from(oferta) y no oferta, para usar el iterador y tener disponible "filters".
         const idiomas = Array.from(oferta).map(ens => ens.filters.length===0 && ens.idi)
                                                  // Eliminamos valores nulos y valores repetidos.
                                                  .filter((idi, i, arr) => idi && arr.indexOf(idi) === i)

         switch(idiomas.length) {
            case 0:
               return null;
               break;
            case 1:
               return idiomas[0];
               break;
            default:
               return "multi";
         }
      });

      const updaterBoliche = (function(o) {
         const paletaOferta = new Array(5).fill(null);
         const paletaPlazas = new Array(7).fill(null);

         // Devuelve blanco o negro dependiendo de cuál contraste mejor con el
         // color RGB suministrado como argumento
         function blancoNegro(rgb) {
            var y = 2.2;

            return (0.2126*Math.pow(rgb[0]/255, y) + 0.7152*Math.pow(rgb[1]/255, y) + 0.0722*Math.pow(rgb[2]/255, y) > Math.pow(0.5, y))?"#000":"#fff";
         }

         paletaOferta[0] = "black";
         for(let i=1; i < paletaOferta.length; i++) {
            paletaOferta[i] = rgb2hex(HSLtoRGB(i/(paletaOferta.length-1)));
         }

         var tintaPlazas = new Array(paletaPlazas).fill(null);
         paletaPlazas[0] = tintaPlazas[0] = "black";
         for(let i=1; i < paletaPlazas.length; i++) {
            let color = HSLtoRGB(i/(paletaPlazas.length-1));
            paletaPlazas[i] = rgb2hex(color);
            tintaPlazas[i] = blancoNegro(color);
         }

         function updater(o) {
            const defs = this.querySelector("defs");
            const content = this.querySelector(".content");

            var e = this.querySelector(".ofervac");
            if(o.numofer !== undefined) {
               let x = e.querySelector("circle");
               x.setAttribute("fill", paletaOferta[Math.min(paletaOferta.length-1, o.numofer)]);
            }

            if(o.numvac !== undefined) {
               let i = Math.min(paletaPlazas.length-1, o.numvac);
               e = e.querySelector("path");
               e.setAttribute("fill", paletaPlazas[i]);
               e = e.nextElementSibling;
               e.textContent = o.numvac;
               e.setAttribute("fill", tintaPlazas[i]);
            }

            if(o.ofervar !== undefined) {
               e = this.querySelector(".ofervar");
               if(!o.ofervar) e.setAttribute("display", "none");
               else {
                  e.removeAttribute("display");
                  e = e.firstElementChild.nextElementSibling;
                  if(o.ofervar > 0) e.removeAttribute("display");
                  else e.setAttribute("display", "none");
               }
            }

            if(o.bil !== undefined) {
               e = content.querySelector(".bil");
               if(e) defs.appendChild(e);
               if(o.bil !== null) content.appendChild(defs.querySelector(".bil." + o.bil));
            }

            if(o.tipo !== undefined) {
               e = content.querySelector(".tipo");
               if(o.tipo === "normal") {
                  if(e) defs.appendChild(e);
               }
               else {
                  if(!e) {
                     e = defs.querySelector(".tipo");
                     content.appendChild(e);
                  }
                  if(o.tipo === "dificil") e.setAttribute("fill", "#c13");
                  else e.setAttribute("fill", "#13b"); 
               }
            }

            if(o.sel !== undefined) {
               e = content.querySelector(".selected");
               if(!o.sel) {
                  if(e) defs.appendChild(e);
               }
               else if(!e) {
                  e = defs.querySelector(".selected");
                  content.prepend(e);
               }
            }
         }

         return updater;
      })();

      return {
         piolin: L.utils.createMutableIconClass("piolin", {
            iconSize: null,
            iconAnchor: [12.5, 34],
            css:  path + "/maps/adjofer/icons/piolin.css",
            html: html,
            converter: converterCSS,
            updater: updaterCSS
         }),
         chupachups: L.utils.createMutableIconClass("chupachups", {
            iconSize: [25, 34],
            iconAnchor: [12.5, 34],
            css:  path + "/maps/adjofer/icons/chupachups.css",
            html: html,
            converter: converterCSS,
            updater: updaterCSS
         }),
         solicitud: L.utils.createMutableIconClass("solicitud", {
            iconSize: [40, 40],
            iconAnchor: [19.556, 35.69],
            url:  path + "/maps/adjofer/icons/solicitud.svg",
            converter: converterSol,
            updater: function(o) {
               var text = this.querySelector("text");
               if(o.peticion !== undefined) {
                  text.textContent = o.peticion;
                  var size = (o.peticion.toString().length > 2)?28:32;
                  text.setAttribute("font-size", size);
               }
               return this;
            }
         }),
         boliche: L.utils.createMutableIconClass("boliche", {
            iconSize: [40, 40],
            iconAnchor: [19.556, 35.69],
            url:  path + "/maps/adjofer/icons/boliche.svg",
            converter: converterBol,
            updater: updaterBoliche,
         }),
      }
   })();

   const ORS = (function (adjofer) {

      const URLBase = "https://api.openrouteservice.org",
            espera = [],
            defaults = {
               chunkProgress: true,
               loading: true,
               rutaPopup: true
            },
            ors = Object.assign({}, defaults, adjofer.options.ors);

      if(ors.chunkProgress === true) ors.chunkProgress = progressBar;
      if(ors.loading === true) ors.loading = ajaxGif;
      if(ors.rutaPopup === true) ors.rutaPopup = crearPopup;

      espera.remove = function(value) {
         const idx = this.indexOf(value);
         if(idx !== -1) {
            this.splice(idx, 1)
            return true;
         }
         return false;
      }

      function failback(xhr) {
         const response = JSON.parse(xhr.responseText);
         console.error("Error " + response.error.code + ": " + response.error.message);
      }

      function ORS() {
         this.espera = espera;
         this.isocronas = new Isocronas();
         this.ruta = new Ruta();
         this.geocode = new Geocode();
      }

      const Isocronas = (function() {

         const url = URLBase + "/v2/isochrones";

         const defaults = {
            profile: "driving-car",
            range_type: "time",
            interval: 600,
            range: 3600,
            location_type: "start",
            intersections: false,
         }

         // Para la interrupción del cálculo de las
         // isocronas. cuando se demora mucho su cálculo.
         const isocronas = {
            interval: 200,
            delay: 50
         }

         // Colocamos las isocronas por debajo de 400, para que siempre
         // queden por debajo de otros polígonos y segmentos (como las rutas).
         adjofer.map.createPane("isochronePane").style.zIndex = 390;

         function Isocronas(opts) {
            try {
               turf
            }
            catch(e) {
               throw new ReferenceError("No se encuentra cargado turf. ¿Ha olvidado cargar la librería en el HTML?");
            }

            this.options = Object.assign({}, defaults);
            this.setOptions(opts);

            this.layer = L.geoJSON(undefined, {
               style: f => new Object({
                              color: rgb2hex(HSLtoRGB(f.properties.ratio, .75, .30)),
                              opacity: 0.6
                           }),
               onEachFeature: (f, l) => {
                  l.bindContextMenu(contextMenuArea.call(this, l, this.layer));
               },
               pane: "isochronePane"
            });

            addDescriptor(this, "areas", false, true);  //false: no hecha, null: en proceso.
            // Resultado del último cálculo, por si se piden
            // otra vez las isocronas definidas por el mismo origen.
            addDescriptor(this, "calc", {origen: null, areas: null}, false);

         }

         Isocronas.prototype.setOptions = function(opts) {
            Object.assign(this.options, opts);
            if(!(this.options.range instanceof Array)) {
               this.options.range = [this.options.range];
            }
            return this;
         }

         /**
          * Crea las isocronas, en principio tomando como referencia la marca de origen.
          * Es función asíncrona cuya promesa devuelve ``null`` si ya había otra petición
          * en curso; ``false``, si se recuperaron las últimas isocronas, ``true``, si
          * se generaron unas nuevas; e ``undefined`, si se produjo un error.
          *
          * @param {Function} callback  Función que se ejecutará al generarse las
          * isocronas sobre el mapa.
          */
         Isocronas.prototype.create = async function() {
            if(this.areas) this.remove();
            
            return new Promise((resolve, reject) => {
               if(this.areas === null) {
                  resolve(null);
                  return;
               }

               espera.push("isocronas");

               // Si repetimos origen, entonces rescatamos las isocronas calculadas.
               if(mismoPunto(adjofer.origen, this.calc.origen)) {
                  redibujarAnillos.call(this);
                  this.layer.addTo(adjofer.map);
                  this.areas = this.calc.areas;
                  resolve(false);
                  return;
               }
               else this.areas = this.calc.origen = this.calc.areas = null;

               let point  = adjofer.origen.getLatLng(),
                   params = Object.assign({locations: [[point.lng, point.lat]]},
                                           this.options);

               if(ors.loading) ors.loading("isocronas");
               L.utils.load({
                  url: url + "/" + params.profile,
                  headers: { Authorization: ors.key },
                  contentType: "application/json; charset=UTF-8",
                  params: params,
                  callback: xhr => {
                     crearIsocronas.call(this, xhr).then(() => {
                        espera.remove("isocronas");
                        resolve(true);
                     });
                  },
                  failback: xhr => { 
                     failback();
                     espera.remove("isocronas");
                     resolve(undefined);
                  }
               });
            });
         }


         async function crearIsocronas(xhr) {
            if(ors.loading) ors.loading("isocronas");

            const started = (new Date()).getTime();
            // Estos polígonos son completamente macizos, es decir,
            // el referido a la isocrona de 30 minutos, contiene
            // también las áreas de 10 y 20 minutos.
            const data = JSON.parse(xhr.responseText);
            this.layer.addTo(adjofer.map);

            return new Promise(resolve => {
               // La ejecución a intervalos se ha tomado del codigo de Leaflet.markercluster
               let i=0;
               const process = () => {
                  const start = (new Date()).getTime();
                  for(; i<data.features.length; i++) {
                     const lapso = (new Date()).getTime() - start;

                     // Al superar el intervalo, rompemos el bucle y
                     // liberamos la ejecución por un breve periodo.
                     if(ors.chunkProgress && lapso > isocronas.interval) break;

                     const anillo = i>0?turf.difference(data.features[i], data.features[i-1]):
                                    Object.assign({}, data.features[0]);

                     // turf hace que anillo y data.features[i] compartan properties,
                     // pero se necesita que sean objetos diferentes para que uno tenga
                     // la propiedad area y el otro no.
                     anillo.properties = Object.assign({}, data.features[i].properties, {
                        ratio:  1 - i/data.features.length,
                        area: data.features[i]  // Las área macizas sirven para filtrado.
                     });
                     data.features[i].properties.ratio = anillo.properties.ratio;

                     this.layer.addData(anillo);
                  }

                  if(ors.chunkProgress) ors.chunkProgress(i, data.features.length,
                                                          (new Date().getTime() - started));

                  if(i === data.features.length) {
                     this.calc.origen = adjofer.origen;
                     this.areas = this.calc.areas = this.layer.getLayers();
                     resolve();
                  }
                  else setTimeout(process, isocronas.delay);
               }
               process();
            });
         }


         /**
          * Elimina las isocronas.
          */
         Isocronas.prototype.remove = function() {
            if(!this.areas) return false;
            this.layer.clearLayers();
            this.layer.removeFrom(adjofer.map);
            this.areas = false;
            return this;
         }


         function contextMenuArea(area) {
            // Los anillos tienen entre sus propiedades el área maciza,
            // pero las áreas macizas, no tienen área alguna.
            const es_anillo = !!area.feature.properties.area;

            const items = [
               {
                  text: "Eliminar isocronas",
                  callback: e => adjofer.setIsocronas(null),
                  index: 0,
               }
            ]

            if(es_anillo) {
               items.push({
                  text: `Filtrar centros alejados más de ${area.feature.properties.value/60} min`,
                  callback: e => {
                     const maciza = area.feature.properties.area;
                     adjofer.Centro.filter("lejos", {area: maciza});
                     adjofer.Centro.invoke("refresh");
                     dibujarAreaMaciza.call(this, maciza);
                  },
                  index: 1,
               })
            }
            else {
               items.push({
                  text: `Mostrar centros alejados más de ${area.feature.properties.value/60} min`,
                  callback: e => {
                     adjofer.Centro.unfilter("lejos");
                     adjofer.Centro.invoke("refresh");
                     redibujarAnillos.call(this);
                  },
                  index: 1
               });
            }

            items.push({separator: true, index: 2});

            return {
               contextmenu: true,
               contextmenuInheritItems: true,
               contextmenuItems: items
            }
         }

         function dibujarAreaMaciza(area) {
            this.layer.clearLayers().addData(area);
            const a = this.layer.getLayers()[0];
            a.bindContextMenu(contextMenuArea.call(this, a));
         }

         function redibujarAnillos() {
            this.layer.clearLayers();
            for(const a of this.calc.areas) this.layer.addLayer(a);
         }

         //TODO:: Falta definir una API para poder acceder cómodamente a las áreas
         // y las áreas macizas, a fin de poder cómodamente en la interfaz virtual
         // lo que se ha hecho aquí con el menú contextual.

         return Isocronas;
      })();


      // Issue #46
      const Geocode = (function() {

         const url = URLBase + "/geocode";

         const defaults = {
            "boundary.country": "ES"  // Restringimos las búsquedas a España.
         }

         function Geocode(opts) {
            this.options = Object.assign({api_key: ors.key}, defaults);
            this.setOptions(opts);

            addDescriptor(this, "value", false, true);
         }

         Geocode.prototype.setOptions = function(opts) {
            Object.assign(this.options, opts);
         }

         /**
          * Realiza la consulta de geocodificación de manera que obtiene
          * unas coordenadas si se introduce una dirección o una dirección
          * si se introducen unas coordenadas.
          *
          * @param {String, L.LatLng} data  Los datos de la consulta.
          *
          */
         Geocode.prototype.query = async function(data) {
            return new Promise((resolve, reject) => {
               if(this.value === null) {
                  resolve(null);
                  return;
               }

               this.value = null;
               espera.push("geocode");

               if(ors.loading) ors.loading("geocodificacion");

               let furl, params;
               if(typeof data === "string") { // Es una dirección.
                  furl = url + "/search";
                  params = Object.assign({text: data}, this.options);
               }
               else {  // Es una coordenada.
                  furl = url + "/reverse";
                  params = Object.assign({"point.lon": data.lng, "point.lat": data.lat}, this.options);
               }

               L.utils.load({
                  url: furl,
                  method: "GET",
                  params: params,
                  callback: xhr => {
                     if(ors.loading) ors.loading("geocode");
                     const response = JSON.parse(xhr.responseText),
                           parser = typeof data === "string"?obtenerCoordenadas:obtenerDireccion;
                     this.value = parser(response, data);
                     espera.remove("geocode");
                     resolve(true);
                  },
                  failback: xhr => {
                     if(ors.loading) ors.loading("geocode");
                     failback(xhr);
                     this.value = JSON.parse(xhr.responseText).error;
                     espera.remove("geocode");
                     resolve(undefined);
                  }
               });
            });
         }

         // TODO:: La obtención de direcciones habría que estudiarla bien.
         function obtenerDireccion(data) {
            return data.features.length === 0?"Dirección desconocida":data.features[0].properties.label;
         }

         function obtenerCoordenadas(data, search) {
            if(data.features.length === 0) {
               console.error(`Imposible localizar '${search}'`);
               return null;
            }

            return data.features;
         }


         return Geocode;
      })();
      // Fin issue #46

      // Issue #47
      const Ruta = (function() {

         const url = URLBase + "/v2/directions";

         const defaults = {
            profile: "driving-car"
         }

         function Ruta(opts) {
            this.options = Object.assign({api_key: ors.key}, defaults);
            this.setOptions(opts);

            this.layer = L.geoJSON(undefined, {
               style: f => new Object({
                              color: "#77f",
                              weight: 5,
                              opacity: 0.9
                           }),
               onEachFeature: (f, l) => {
                  if(ors.rutaPopup) {
                     l.bindPopup(ors.rutaPopup(this.calc.destino, f));
                  }
               }
            });

            addDescriptor(this, "value", false, true); // value= {polininea, destino}
            addDescriptor(this, "calc", {origen: null,
                                         destino: null,
                                         layer: null}, true);
         }

         Ruta.prototype.setOptions = function(opts) {
            Object.assign(this.options, opts);
         }

         Ruta.prototype.create = async function(destino) {
            if(this.value) this.remove();

            return new Promise((resolve, reject) => {
               if(this.value === null) {
                  resolve(null);
                  return;
               }

               if(mismoPunto(adjofer.origen, this.calc.origen) &&
                  mismoPunto(destino, this.calc.destino)) {

                  dibujarRuta.call(this);
                  this.value = {
                     layer: this.calc.layer,
                     destino: this.calc.destino
                  }
                  resolve(false);
                  return;
               }

               espera.push("rutas");

               this.value = this.calc.destino = this.calc.layer = null;
               this.calc.origen = adjofer.origen;

               const origen = adjofer.origen.getLatLng(),
                     fin    = destino.getLatLng(),
                     params = Object.assign({
                                 start: origen.lng + "," + origen.lat,
                                 end: fin.lng + "," + fin.lat,
                              }, this.options),
                     furl = url + "/" + params.profile;

               delete params.profile;
               
               if(ors.loading) ors.loading("ruta");
               L.utils.load({
                  url: furl,
                  method: "GET",
                  params: params,
                  callback: xhr => { 
                     crearRuta.call(this, xhr, destino);
                     espera.remove("rutas");
                     resolve(true);
                  },
                  failback: xhr => {
                     failback(xhr);
                     espera.remove("rutas");
                     resolve(undefined);
                  }
               });
            });
         }

         function crearRuta(xhr, destino) {
            if(ors.loading) ors.loading("ruta");

            const data = JSON.parse(xhr.responseText);
            this.calc.destino = destino;
            this.calc.origen = adjofer.origen;
            this.value = {destino: destino};

            this.calc.layer = this.value.layer = dibujarRuta.call(this, data);
         }

         function dibujarRuta(ruta) {
            let layer;

            // Si no se proporciona ruta, es porque
            // se reaprovecha la marca almacenada en calc.
            if(ruta === undefined) {
               layer = this.calc.layer;
               ruta = layer.feature;
               this.layer.addLayer(layer);
            }
            else {
               this.layer.addData(ruta);
               ruta = ruta.features[0];
               layer = this.layer.getLayers()[0];
            }

            this.layer.addTo(adjofer.map);

            const coords = ruta.geometry.coordinates,
                  point  = coords[Math.floor(.9*coords.length)];

            if(ors.rutaPopup) layer.openPopup({lat: point[1], lng: point[0]});
            return layer;
         }

         Ruta.prototype.remove = function() {
            if(!this.value) return false;

            this.layer.clearLayers();
            this.layer.removeFrom(adjofer.map);
            this.value = false;
            return this;
         }

         return Ruta;
      })();
      // Fin issue #47


      function mismoPunto(x, y) {
         if(x === null || y === null) return false;
         x = x.getLatLng();
         y = y.getLatLng();
         return x.lat === y.lat && x.lng === y.lng;
      }

      return new ORS();
   });


   function crearPopup(destino, ruta) {
      const container = document.createElement("article"),
            distancia = Math.floor(ruta.properties.summary.distance / 1000),
            tiempo = (function(t) {  // Pasa segundos a horas y minutos.
               let m = Math.floor(t/60);
               if(m > 60) {
                  const h = Math.floor(m/60);
                  m %= 60;
                  return `${h}h ${m}m`;
               }
               else return m + "m";
            })(ruta.properties.summary.duration);

      let e = document.createElement("h3");

      e.textContent = destino.getData().id.nom;
      container.appendChild(e);

      let ul = document.createElement("ul"),
          li = document.createElement("li");

      ul.appendChild(li);
      e = document.createElement("b");
      e.textContent = "Distancia";
      li.appendChild(e);
      li.appendChild(document.createTextNode(`: ${distancia} Km`));
      
      li = document.createElement("li");
      ul.appendChild(li);

      e = document.createElement("b");
      e.textContent = "Tiempo est.";
      li.appendChild(e);
      li.appendChild(document.createTextNode(`: ${tiempo}`));

      container.appendChild(ul);

      return container;
   }


   function progressBar(n, total, lapso) {
      const map = L.DomUtil.get("map"),
            progress = L.DomUtil.get("leaflet-progress") || 
                       L.DomUtil.create("progress", "leaflet-message leaflet-control", map);
      progress.id = "leaflet-progress";
      progress.setAttribute("value", n/total);
      if(n === total) setTimeout(() => L.DomUtil.remove(progress), 500);
   }


   // tipo: isocronas, geocode, ruta.
   function ajaxGif(tipo) {
      let loading;
      
      if(loading = L.DomUtil.get("leaflet-loading")) {
         L.DomUtil.remove(loading);
      }
      else {
         loading = L.DomUtil.create("div", "leaflet-message leaflet-control", 
                                    L.DomUtil.get("map"));
         loading.id = "leaflet-loading";
         const img = document.createElement("img");
         img.setAttribute("src",  path + "/maps/adjofer/images/ajax-loader.gif");
         loading.appendChild(img);
      }
   }


   return new MapAdjOfer(opts);
});
