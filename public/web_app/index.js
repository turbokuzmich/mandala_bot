Telegram.WebApp.ready();

const userInfo = document.querySelector(".js-user-info");
const actionsPane = document.querySelector(".js-pane-actions");
const pointInfo = document.querySelector(".js-point-info");
const appendButton = document.querySelector(".js-button-append");
const cancelButton = document.querySelector(".js-button-cancel");

const api = axios.create({
  baseURL: "https://m.deluxspa.ru/api",
});

function fromYMapsEvents(entity, events) {
  return new rxjs.Observable(function (subscriber) {
    function onEvent(event) {
      subscriber.next(event);
    }

    entity.events.add(events, onEvent);

    return function () {
      entity.event.remove(events, onEvent);
    };
  });
}

function request$(method, ...args) {
  return new rxjs.Observable(function (subscriber) {
    let isSubscribed = true;

    api[method](...args)
      .then(function ({ data }) {
        if (isSubscribed) {
          subscriber.next(data);
          subscriber.complete();
        }
      })
      .catch(function (error) {
        if (isSubscribed) {
          subscriber.error(error);
        }
      });

    return () => {
      isSubscribed = false;
    };
  });
}

function get$(...args) {
  return request$("get", ...args);
}

function post$(...args) {
  return request$("post", ...args);
}

const ymaps$ = new rxjs.Observable(function (subscriber) {
  let isSubscribed = true;

  ymaps.ready(function () {
    if (isSubscribed) {
      subscriber.next(ymaps);
      subscriber.complete();
    }
  });

  return () => {
    isSubscribed = false;
  };
}).pipe(rxjs.shareReplay(1));

const map$ = ymaps$.pipe(
  rxjs.map(
    (ymaps) =>
      new ymaps.Map("map", {
        center: [55.76, 37.64],
        zoom: 7,
      })
  ),
  rxjs.shareReplay(1)
);

const mapClicks$ = map$.pipe(
  rxjs.mergeMap((map) => fromYMapsEvents(map, "click")),
  rxjs.shareReplay(1)
);

const balloonCloses = map$.pipe(
  rxjs.mergeMap((map) => fromYMapsEvents(map.balloon, "close")),
  rxjs.shareReplay(1)
);

const cancelClicks$ = rxjs.fromEvent(cancelButton, "click");
const appendClicks$ = rxjs.fromEvent(appendButton, "click");

const newPointCoords$ = rxjs
  .merge(
    mapClicks$.pipe(rxjs.map((event) => event.get("coords"))),
    balloonCloses.pipe(rxjs.map(() => null))
  )
  .pipe(rxjs.distinctUntilChanged(), rxjs.shareReplay(1));

const cluster$ = rxjs.combineLatest([ymaps$, map$]).pipe(
  rxjs.map(([ymaps, map]) =>
    map.geoObjects.getLength() === 0
      ? {
          isAppended: false,
          cluster: new ymaps.Clusterer({
            groupByCoordinates: false,
            clusterDisableClickZoom: true,
            clusterHideIconOnBalloonOpen: false,
            geoObjectHideIconOnBalloonOpen: false,
          }),
        }
      : { isAppended: true, cluster: map.geoObjects.get(0) }
  )
);

const user$ = ymaps$.pipe(
  rxjs.map(() => new URL(location.href).searchParams.get("chat_id")),
  rxjs.mergeMap((chatId) =>
    get$("/me", {
      params: {
        chat_id: chatId,
      },
    }).pipe(
      rxjs.map(({ username }) => ({ isAuthorized: true, username })),
      rxjs.catchError(() => rxjs.of({ isAuthorized: false, username: "guest" }))
    )
  ),
  rxjs.shareReplay(1)
);

const pointAppended$ = user$.pipe(
  rxjs.take(1),
  rxjs.map(({ username }) =>
    newPointCoords$.pipe(
      rxjs.map((coords) =>
        coords
          ? appendClicks$.pipe(
              rxjs.map(() =>
                coords
                  ? post$("/map/points", {
                      user: username,
                      latitude: coords[0],
                      longitude: coords[1],
                    })
                  : rxjs.EMPTY
              ),
              rxjs.switchAll()
            )
          : rxjs.EMPTY
      ),
      rxjs.switchAll()
    )
  ),
  rxjs.switchAll(),
  rxjs.share()
);

const points$ = rxjs
  .merge(pointAppended$, ymaps$.pipe(rxjs.mergeMap(() => get$("/map/points"))))
  .pipe(
    rxjs.map(({ points }) => points),
    rxjs.shareReplay(1)
  );

const placemarks$ = rxjs.combineLatest([points$, ymaps$]).pipe(
  rxjs.map(([points, ymaps]) =>
    points.map(
      (point) =>
        new ymaps.Placemark(
          [point.latitude, point.longitude],
          {
            balloonContentHeader: "Точка",
            balloonContentBody: `obanze`,
          },
          {
            preset: "islands#circleIcon",
          }
        )
    )
  ),
  rxjs.shareReplay(1)
);

user$.subscribe(function ({ isAuthorized, username }) {
  userInfo.innerHTML = isAuthorized
    ? `Пользователь: ${username}`
    : "Неавторизованный пользователь";
});

newPointCoords$.subscribe(function (coords) {
  if (coords) {
    pointInfo.innerHTML = `Добавить новую точку по координатам ${coords[0].toPrecision(
      6
    )}, ${coords[1].toPrecision(6)}?`;
    actionsPane.classList.add("visible");
  } else {
    actionsPane.classList.remove("visible");
  }
});

map$
  .pipe(
    rxjs.map((map) =>
      rxjs
        .of(
          cancelClicks$.pipe(rxjs.map(() => map)),
          pointAppended$.pipe(rxjs.map(() => map))
        )
        .pipe(rxjs.mergeAll())
    ),
    rxjs.switchAll()
  )
  .subscribe(function (map) {
    map.balloon.close();
  });

rxjs
  .combineLatest([map$, newPointCoords$.pipe(rxjs.filter(Boolean))])
  .subscribe(function ([map, coords]) {
    map.balloon.open(coords, {
      contentHeader: "Новая точка",
      contentBody: `<p>Координаты точки: ${coords[0].toPrecision(
        5
      )}:${coords[1].toPrecision(6)}.`,
    });
  });

map$
  .pipe(
    rxjs.map((map) =>
      placemarks$.pipe(
        rxjs.map((placemarks) =>
          cluster$.pipe(
            rxjs.map((clusterData) => ({ map, placemarks, clusterData }))
          )
        ),
        rxjs.switchAll()
      )
    ),
    rxjs.switchAll()
  )
  .subscribe(function ({
    map,
    placemarks,
    clusterData: { isAppended, cluster },
  }) {
    if (isAppended) {
      cluster.removeAll();
      cluster.add(placemarks);
    } else {
      cluster.add(placemarks);
      map.geoObjects.add(cluster);
    }
  });

pointAppended$.subscribe();

function init() {
  function updateSelectedCoords(coords) {
    selectedPointCoords = coords;

    if (selectedPointCoords && selectedPointCoords.length) {
      appendButton.disabled = false;
    } else {
      appendButton.disabled = true;
    }
  }

  async function onPointAppend() {
    const [latitude, longitude] = selectedPointCoords;

    const {
      data: { points },
    } = await api.post("/map/points", {
      user: "test",
      latitude,
      longitude,
    });

    updateSelectedCoords(null);
    renderPoints(points);
  }
  function renderPoints(points) {
    const placemarks = points.map((point) => {
      const placemark = new ymaps.Placemark(
        [point.latitude, point.longitude],
        {
          balloonContentHeader: "Точка",
          balloonContentBody: `obanze`,
        },
        {
          preset: "islands#circleIcon",
        }
      );

      return placemark;
    });

    if (map.geoObjects.getLength()) {
      const clusterer = map.geoObjects.get(0);

      clusterer.removeAll();
      clusterer.add(placemarks);
    } else {
      const clusterer = new ymaps.Clusterer({
        groupByCoordinates: false,
        clusterDisableClickZoom: true,
        clusterHideIconOnBalloonOpen: false,
        geoObjectHideIconOnBalloonOpen: false,
      });

      clusterer.balloon.events.add(["open", "click"], () => {
        const { cluster } = clusterer.balloon.getData();
        const object = cluster.state.get("activeObject");
        object.events.fire("point:selected");
      });

      clusterer.add(placemarks);
      map.geoObjects.add(clusterer);
    }
  }
  map.events.add("click", onMapClick);
  map.balloon.events.add("close", onBalloonClose);

  appendButton.addEventListener("click", onPointAppend);

  fetchUsername();
  fetchPoints();
}

// ymaps.ready(init);
